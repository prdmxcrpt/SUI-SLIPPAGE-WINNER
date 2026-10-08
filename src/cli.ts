import { Command } from 'commander';
import * as fs from 'node:fs';
import * as process from 'node:process';
import { createSuiClients } from './clients.js';
import { discoverPoolsForCoin, verifyRecentPoolActivity } from './discovery.js';
import { calculateArbitrageOpportunities } from './calculation.js';

const program = new Command();

program
  .name('sui-arbitrage')
  .description('Discover, filter, and calculate executable cross-pool arbitrage opportunities on Sui Mainnet')
  .version('1.0.0')
  .requiredOption('-c, --coin <type>', 'Target Sui Coin Type (e.g. 0x2::sui::SUI or Move coin struct address)')
  .option('-a, --amount <amount>', 'Base capital deployment input amount in MIST', '10000000000')
  .option('-o, --out <path>', 'JSON Output File path for full report', 'arbitrage_report.json')
  .action(async (options) => {
    const coinType = options.coin;
    const testAmount = BigInt(options.amount);

    console.log(`\n======================================================`);
    console.log(`         SUI MAINNET CROSS-POOL ARBITRAGE ENGINE      `);
    console.log(`======================================================`);
    console.log(`Target Coin ID / Type: ${coinType}`);
    console.log(`Capital Deployment:   ${testAmount.toString()} MIST (${(Number(testAmount) / 1e9).toFixed(4)} SUI / Base Coin)\n`);

    const clients = createSuiClients();

    console.log(`[1/3] Discovering & validating active pools on Sui Mainnet (gRPC / GraphQL)...`);
    const pools = await discoverPoolsForCoin(clients, coinType);
    console.log(`Found ${pools.length} active, healthy, and supported pools matching target coin.`);

    for (const pool of pools) {
      const active = await verifyRecentPoolActivity(clients, pool.id);
      console.log(` - [${pool.protocol}] Pool ID ${pool.id.slice(0, 14)}... | Activity verified: ${active}`);
    }

    console.log(`\n[2/3] Computing optimal trade paths & itemizing fee/gas costs...`);
    const opps = await calculateArbitrageOpportunities(coinType, pools, testAmount, clients);

    console.log(`[3/3] Analysis complete. Valid profitable opportunities found: ${opps.length}\n`);

    if (opps.length === 0) {
      console.log(`No profitable arbitrage routes found above trading fee and Sui network gas thresholds.`);
      const emptyReport = {
        selectedCoin: coinType,
        capitalDeploymentMist: testAmount.toString(),
        opportunitiesFound: 0,
        opportunities: [],
      };
      fs.writeFileSync(options.out, JSON.stringify(emptyReport, null, 2));
      console.log(`Report saved to ${options.out}`);
      return;
    }

    const best = opps[0];
    console.log(`================ TOP ARBITRAGE OPPORTUNITY ================`);
    console.log(`Selected Coin:       ${best.targetCoin}`);
    console.log(`Execution Route:     ${best.executionRouteDescription}`);
    console.log(`Capital Deployment:  ${best.optimalInputAmount.toString()} MIST`);
    console.log(`Expected Output:     ${best.expectedOutputAmount.toString()} MIST`);
    console.log(`Cost Breakdown:`);
    console.log(`  - Source Trade Fee: ${best.tradingFees.sourceFeeAmount.toString()} (${best.tradingFees.sourceFeeCoin})`);
    console.log(`  - Target Trade Fee: ${best.tradingFees.targetFeeAmount.toString()} (${best.tradingFees.targetFeeCoin})`);
    if (best.tradingFees.isDeepFee) {
      console.log(`  - DEEP Token Fee:   Enabled (DeepBook V3 Staking Discount Applied)`);
    }
    console.log(`  - Sui Network Gas:  ${best.estimatedGasSui.toString()} MIST (~0.005 SUI via dryRun simulation)`);
    console.log(`Net Profit:          ${best.netProfit.toString()} MIST`);
    console.log(`Net ROI:             ${best.roiPercentage.toFixed(4)}%`);
    console.log(`Pool Status Health:`);
    best.healthCheckConfirmLogs.forEach((log) => console.log(`  ✓ ${log}`));
    console.log(`===========================================================\n`);

    // Serialize BigInt values for JSON report
    const jsonOutput = JSON.stringify(
      {
        selectedCoin: coinType,
        capitalDeploymentMist: testAmount.toString(),
        opportunitiesFound: opps.length,
        topOpportunity: best,
        allOpportunities: opps,
      },
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
      2
    );

    fs.writeFileSync(options.out, jsonOutput);
    console.log(`Full report successfully exported to ${options.out}`);
  });

program.parse(process.argv);
