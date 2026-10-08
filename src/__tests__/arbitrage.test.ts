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

  it('should discover active CHILLBULL pools and compute arbitrage opportunities', async () => {
    const clients = createSuiClients();
    const chillbullCoin = '0x7fb8f3f8730f78d656fb39f60bc9c090beae8e51b6a7ec26315ef98ecb856c3d::chillbull::CHILLBULL';
    const pools = await discoverPoolsForCoin(clients, chillbullCoin);
    expect(pools.length).toBeGreaterThan(0);
    pools.forEach((p) => {
      expect(p.health.isValid).toBe(true);
      expect(p.coinA === chillbullCoin || p.coinB === chillbullCoin).toBe(true);
    });

    const opps = await calculateArbitrageOpportunities(chillbullCoin, pools, 10_000_000_000n, clients);
    expect(Array.isArray(opps)).toBe(true);
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

  it('should calculate DeepBook V3 CLOB swap output by walking order depth', () => {
    const mockDeepBook: PoolState = {
      id: '0xmock_deepbook',
      protocol: 'DEEPBOOK_V3',
      coinA: '0x2::sui::SUI',
      coinB: '0xUSDC',
      reserveA: 1_000_000_000_000n,
      reserveB: 3_000_000_000_000n,
      feeBps: 10,
      health: { isPaused: false, isDestroyed: false, hasSufficientLiquidity: true, isVersionSupported: true, isValid: true },
      deepbookParams: { tickSize: 1000n, lotSize: 1000000n, minSize: 10000000n },
      bids: [{ price: 3.0, quantity: 100 }],
      asks: [{ price: 3.1, quantity: 100 }],
      midPrice: 3.05,
    };

    const res = calculateDeepBookSwapOutput(mockDeepBook, '0x2::sui::SUI', 1_000_000_000n);
    expect(res.outputAmount).toBeGreaterThan(0n);
    expect(res.feeAmount).toBeGreaterThan(0n);
    expect(res.isDeepFee).toBe(true);
  });

  it('should identify profitable cross-pool arbitrage opportunities between DeepBook V3 and CLMM/AMM', async () => {
    const suiCoin = '0x2::sui::SUI';
    const usdcCoin = '0xUSDC';

    const pools: PoolState[] = [
      {
        id: '0xcheap_sui_pool',
        protocol: 'DEEPBOOK_V3',
        coinA: suiCoin,
        coinB: usdcCoin,
        reserveA: 10_000_000_000_000n,
        reserveB: 10_000_000_000_000n, // ~1 USDC / SUI
        feeBps: 10,
        health: { isPaused: false, isDestroyed: false, hasSufficientLiquidity: true, isVersionSupported: true, isValid: true },
        bids: [{ price: 3.5, quantity: 1000 }],
        asks: [{ price: 2.0, quantity: 1000 }],
        midPrice: 2.0,
      },
      {
        id: '0xexpensive_sui_pool',
        protocol: 'CETUS_CLMM',
        coinA: suiCoin,
        coinB: usdcCoin,
        reserveA: 1_000_000_000_000n,
        reserveB: 4_000_000_000_000n, // ~4 USDC / SUI
        feeBps: 10,
        health: { isPaused: false, isDestroyed: false, hasSufficientLiquidity: true, isVersionSupported: true, isValid: true },
      },
    ];

    const opps = await calculateArbitrageOpportunities(suiCoin, pools, 10_000_000_000n);
    expect(opps.length).toBeGreaterThan(0);
    expect(opps[0].netProfit).toBeGreaterThan(0n);
    expect(opps[0].healthCheckConfirmLogs.length).toBeGreaterThan(0);
  });
});
