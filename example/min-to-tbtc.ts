import {
  batchRequest,
  BatchRequestConfig,
  Blockfrost,
  Lucid,
  toUnit,
  MIN_SYMBOL_PREPROD,
  MIN_TOKEN_NAME,
  batchSwap,
  SwapConfig,
  fetchUsersBatchRequestUTxOs,
  BatchSwapConfig,
  Result,
  TxComplete,
} from "../src/index.js";
//     ^---------------^
// In your project this source should change to:
// "@anastasia-labs/smart-handles-offchain"

const blockfrostKey = process.env.BLOCKFROST_KEY;

// Seed phrases are space separated words

const seedPhrase = process.env.SEED_PHRASE;

const routingAgentsSeedPhrase = process.env.ROUTING_SEED_PHRASE;

if (!blockfrostKey)
  throw new Error("No Blockfrost API key was found (BLOCKFROST_KEY)");
if (!seedPhrase) throw new Error("No wallet seed phrase found (SEED_PHRASE)");
if (!routingAgentsSeedPhrase)
  throw new Error(
    "Routing agent's wallet seed phrase not found (ROUTING_SEED_PHRASE)"
  );

const signAndSubmitTxRes = async (
  lucid: Lucid,
  txRes: Result<TxComplete>
): Promise<string> => {
  if (txRes.type == "error") throw txRes.error;

  const txSigned = await txRes.data.sign().complete();

  const txHash = await txSigned.submit();

  await lucid.awaitTx(txHash);

  return txHash;
};

const run = async () => {
  const lucid = await Lucid.new(
    new Blockfrost(
      "https://cardano-preprod.blockfrost.io/api/v0",
      blockfrostKey
    ),
    "Preprod"
  );

  lucid.selectWalletFromSeed(seedPhrase);

  const requestConfig: BatchRequestConfig = {
    swapRequests: [6_000_000, 4_000_000].map((l) => ({
      fromAsset: toUnit(MIN_SYMBOL_PREPROD, MIN_TOKEN_NAME),
      quantity: BigInt(l),
      toAsset: toUnit(
        "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72",
        "74425443"
      ),
    })),
    testnet: true,
  };

  const requestTxUnsignedRes = await batchRequest(lucid, requestConfig);

  console.log("Submitting the swap requests...");
  const requestTxHash = await signAndSubmitTxRes(lucid, requestTxUnsignedRes);
  console.log(`Request Successfully Submitted: ${requestTxHash}`);

  const userAddress = await lucid.wallet.address();

  lucid.selectWalletFromSeed(routingAgentsSeedPhrase);
  console.log("(switched to the routing agent's wallet)");

  console.log("Fetching user's batch requests...");
  const usersRequests = await fetchUsersBatchRequestUTxOs(
    lucid,
    userAddress,
    true
  );
  console.log("Fetch completed:");
  console.log(usersRequests);

  const swapConfig: SwapConfig = {
    blockfrostKey,
    slippageTolerance: BigInt(10),
  };

  const batchSwapConfig: BatchSwapConfig = {
    swapConfig,
    requestOutRefs: usersRequests.map((u) => u.outRef),
    testnet: true,
  };

  const swapTxUnsigned = await batchSwap(lucid, batchSwapConfig);

  console.log("Submitting the swap transaction...");
  const swapTxHash = await signAndSubmitTxRes(lucid, swapTxUnsigned);
  console.log(`Swap successfully performed: ${swapTxHash}`);
};

run();
