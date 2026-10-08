import { describe, it, expect } from 'vitest';
import { validatePoolHealth, discoverPoolsForCoin, verifyRecentPoolActivity } from '../discovery.js';
import { calculateSwapOutput, calculateDeepBookSwapOutput, calculateArbitrageOpportunities } from '../calculation.js';
import { createSuiClients } from '../clients.js';
import { PoolState } from '../types.js';

describe('Sui Cross-Pool Arbitrage Engine Test Suite', () => {
  it('should instantiate Sui gRPC and GraphQL clients correctly', () => {
    const clients = createSuiClients();
    expect(clients.grpc).toBeDefined();
    expect(clients.graphql).toBeDefined();
  });

  it('should reject paused, destroyed, unsupported, or low liquidity pools in health check', () => {
    const paused = validatePoolHealth({ isPaused: true });
    expect(paused.isValid).toBe(false);
    expect(paused.reason).toContain('paused');

    const destroyed = validatePoolHealth({ isDestroyed: true });
    expect(destroyed.isValid).toBe(false);
    expect(destroyed.reason).toContain('destroyed');

    const unsupported = validatePoolHealth({ isVersionSupported: false });
    expect(unsupported.isValid).toBe(false);
    expect(unsupported.reason).toContain('supported');

    const lowLiq = validatePoolHealth({ reserveA: 10n, reserveB: 10n, minThreshold: 1000n });
    expect(lowLiq.isValid).toBe(false);
    expect(lowLiq.reason).toContain('threshold');

    const healthy = validatePoolHealth({ reserveA: 10000n, reserveB: 10000n });
    expect(healthy.isValid).toBe(true);
  });

  it('should verify pool event query helper', async () => {
    const clients = createSuiClients();
    const result = await verifyRecentPoolActivity(clients, '0x07f12e848651048b61e27a696fa098aa90be5c2765369be32777b7ee32717a6a');
    expect(typeof result).toBe('boolean');
  });

  it('should discover active pools for a target coin and exclude invalid ones', async () => {
    const clients = createSuiClients();
    const pools = await discoverPoolsForCoin(clients, '0x2::sui::SUI');
    expect(pools.length).toBeGreaterThan(0);
    pools.forEach((p) => {
      expect(p.health.isValid).toBe(true);
      expect(p.coinA === '0x2::sui::SUI' || p.coinB === '0x2::sui::SUI').toBe(true);
    });
  });

  it('should calculate swap output accurately for standard AMM curve with fees', () => {
    const mockPool: PoolState = {
      id: '0xmock_amm',
      protocol: 'AMM',
      coinA: '0x2::sui::SUI',
      coinB: '0xUSDC',
      reserveA: 1_000_000_000_000n, // 1000 SUI
      reserveB: 3_000_000_000_000n, // 3000 USDC
      feeBps: 30, // 0.3%
      health: { isPaused: false, isDestroyed: false, hasSufficientLiquidity: true, isVersionSupported: true, isValid: true },
    };

    const output = calculateSwapOutput(mockPool, '0x2::sui::SUI', 10_000_000_000n);
    expect(output).toBeGreaterThan(0n);
    expect(output).toBeLessThan(30_000_000_000n);
  });

  it('should calculate DeepBook V3 CLOB swap output by walking order depth with decimal scaling', () => {
    const mockDeepBook: PoolState = {
      id: '0xmock_deepbook',
      protocol: 'DEEPBOOK_V3',
      coinA: '0x2::sui::SUI',
      coinB: '0xUSDC',
      coinADecimals: 9,
      coinBDecimals: 6,
      reserveA: 1_000_000_000_000n,
      reserveB: 3_000_000_000_000n,
      feeBps: 10,
      health: { isPaused: false, isDestroyed: false, hasSufficientLiquidity: true, isVersionSupported: true, isValid: true },
      deepbookParams: { tickSize: 1000n, lotSize: 1000000n, minSize: 10000000n },
      bids: [{ price: 3.0, quantity: 100 }],
      asks: [{ price: 3.1, quantity: 100 }],
      midPrice: 3.05,
    };

    // 1 SUI input (1,000,000,000 MIST). Fee 10 bps -> 0.999 SUI effective. Bid price 3.0 USDC/SUI.
    // 0.999 SUI * 3.0 USDC/SUI = 2.997 USDC = 2,997,000 USDC raw units (6 decimals).
    const res = calculateDeepBookSwapOutput(mockDeepBook, '0x2::sui::SUI', 1_000_000_000n);
    expect(res.outputAmount).toBe(2_997_000n);
    expect(res.feeAmount).toBe(1_000_000n);
    expect(res.isDeepFee).toBe(true);

    // Swap quote back to base (USDC -> SUI)
    // 2.997 USDC input (2,997,000 raw units). Fee 10 bps -> 2,994,003 raw units. Ask price 3.1 USDC/SUI.
    // (2,994,003 / 3.1) * 10^3 = 965,807,419 MIST (~0.9658 SUI).
    const resBack = calculateDeepBookSwapOutput(mockDeepBook, '0xUSDC', 2_997_000n);
    expect(resBack.outputAmount).toBe(965_807_419n);
  });

  it('should identify Route 3 (Cetus -> Turbos) as top opportunity and exclude unprofitable DeepBook routes', async () => {
    const clients = createSuiClients();
    const pools = await discoverPoolsForCoin(clients, '0x2::sui::SUI');
    const opps = await calculateArbitrageOpportunities('0x2::sui::SUI', pools, 10_000_000_000n, clients);

    expect(opps.length).toBeGreaterThan(0);
    const top = opps[0];

    // Top opportunity must be Cetus -> Turbos (Route 3)
    expect(top.sourcePool.protocol).toBe('CETUS_CLMM');
    expect(top.targetPool.protocol).toBe('TURBOS_CLMM');
    expect(top.roiPercentage).toBeGreaterThan(2.0);
    expect(top.roiPercentage).toBeLessThan(3.0);
    expect(top.netProfit).toBeGreaterThan(200_000_000n); // ~0.21 SUI
    expect(top.healthCheckConfirmLogs.length).toBeGreaterThan(0);
  });
});
