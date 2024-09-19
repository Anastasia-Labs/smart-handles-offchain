## Sample Transactions on Preprod

Request transaction for swapping 37 ADA to MIN: [`9d620c0c847a078ca50325ab28d1a47c5e5a257823ca49e36e33a41ff03bc97a`](https://preprod.cardanoscan.io/transaction/9d620c0c847a078ca50325ab28d1a47c5e5a257823ca49e36e33a41ff03bc97a)

Corresponding route transaction: [`8b3580a52d5ee716de2dbfad689473e4b2bd814ec52ffda8d35f98cd87108047`](https://preprod.cardanoscan.io/transaction/8b3580a52d5ee716de2dbfad689473e4b2bd814ec52ffda8d35f98cd87108047)

Reclaim transaction of a request: [`baf792217d8ed1fb19c025f479e1241545e977627557bcc3f04188d28a455dcb`](https://preprod.cardanoscan.io/transaction/baf792217d8ed1fb19c025f479e1241545e977627557bcc3f04188d28a455dcb)

## How to Replicate

### 1. Install Dependencies and Build the Package

```sh
pnpm install && pnpm run cli
```

### 2. Set `$SEED_PHRASE` Environment Variable

Note that this wallet needs to have some test ADA.

```sh
export SEED_PHRASE=$(cat ~/preprod_wallet.seed)
```

### 3. Submit Your Swap Request

You can read more about how the CLI interface in
[`smart-handles-agent`](https://github.com/Anastasia-Labs/smart-handles-agent) repository.

```sh
node dist/cli.js submit-advanced       \
  --lovelace 37000000                  \
  --owner $(cat ~/preprod_wallet.addr) \
  --router-fee 1000000                 \
  --reclaim-router-fee 0               \
  --extra-config extra.config.json
```

### 4. (Optional) Switch to Another Wallet

This step is supposed to be performed by the routing agent.

```sh
export SEED_PHRASE=$(cat ~/preprod_wallet_2.seed)
```

### 5. Run the Monitoring Endpoint of CLI

By monitoring the same instance of smart handles to which we just submitted a
route request, the application can perform the route and collect its 1 ADA
router fee.

```sh
node dist/cli.js monitor
```
