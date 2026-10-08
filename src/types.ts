export type ProtocolType = 'DEEPBOOK_V3' | 'CETUS_CLMM' | 'TURBOS_CLMM' | 'KRIYA_CLMM' | 'FLOWX_AMM' | 'AMM';

export interface PoolHealth {
  isPaused: boolean;
  isDestroyed: boolean;
  hasSufficientLiquidity: boolean;
  isVersionSupported: boolean;
  isValid: boolean;
  reason?: string;
}

export interface PoolBookParams {
  tickSize: bigint;
  lotSize: bigint;
  minSize: bigint;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface VaultBalances {
  baseBalance: bigint;
  quoteBalance: bigint;
  deepBalance: bigint;
}

export interface PoolState {
  id: string;
  protocol: ProtocolType;
  coinA: string; // Base coin
  coinB: string; // Quote coin
  coinADecimals?: number; // Decimals of base coin (e.g. 9 for SUI)
  coinBDecimals?: number; // Decimals of quote coin (e.g. 6 for USDC)
  reserveA: bigint;
  reserveB: bigint;
  feeBps: number; // e.g. 10 = 0.10%
  health: PoolHealth;

  // DeepBook V3 Specific fields
  deepbookParams?: PoolBookParams;
  vaultBalances?: VaultBalances;
  balanceManagerId?: string;
  bids?: OrderBookLevel[];
  asks?: OrderBookLevel[];
  midPrice?: number;

  // CLMM Specific fields
  sqrtPrice?: bigint;
  tickSpacing?: number;
}

export interface TradingFeeDetail {
  sourceFeeCoin: string;
  sourceFeeAmount: bigint;
  targetFeeCoin: string;
  targetFeeAmount: bigint;
  isDeepFee?: boolean;
  deepFeeAmount?: bigint;
}

export interface ArbitrageOpportunity {
  targetCoin: string;
  sourcePool: PoolState;
  targetPool: PoolState;
  optimalInputAmount: bigint;
  expectedOutputAmount: bigint;
  tradingFees: TradingFeeDetail;
  estimatedGasSui: bigint;
  netProfit: bigint;
  roiPercentage: number;
  executionRouteDescription: string;
  healthCheckConfirmLogs: string[];
}
