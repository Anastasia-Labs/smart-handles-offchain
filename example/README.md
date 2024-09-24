## Sample Transactions on Preprod

### Minswap V1

Request transaction for swapping 37 ADA to MIN: [`9d620c0c847a078ca50325ab28d1a47c5e5a257823ca49e36e33a41ff03bc97a`](https://preprod.cardanoscan.io/transaction/9d620c0c847a078ca50325ab28d1a47c5e5a257823ca49e36e33a41ff03bc97a)

Corresponding route transaction: [`8b3580a52d5ee716de2dbfad689473e4b2bd814ec52ffda8d35f98cd87108047`](https://preprod.cardanoscan.io/transaction/8b3580a52d5ee716de2dbfad689473e4b2bd814ec52ffda8d35f98cd87108047)

Reclaim transaction of a request: [`baf792217d8ed1fb19c025f479e1241545e977627557bcc3f04188d28a455dcb`](https://preprod.cardanoscan.io/transaction/baf792217d8ed1fb19c025f479e1241545e977627557bcc3f04188d28a455dcb)

### Minswap V2 ADA-MIN Swap

Request transaction for swapping 100 ADA to MIN: [`f11bad50d65f3f8e06e0ba46878f8fa1634e8b214bbe106ac0826f654976da25`](https://preprod.cardanoscan.io/transaction/f11bad50d65f3f8e06e0ba46878f8fa1634e8b214bbe106ac0826f654976da25)

Corresponding route transaction: [`93075a97e47afd98b473a3aa69984d5dbf6c6d8905825f3592b22d6f6ac97777`](https://preprod.cardanoscan.io/transaction/93075a97e47afd98b473a3aa69984d5dbf6c6d8905825f3592b22d6f6ac97777)

Transaction performed by batcher: [`8e07a6a3c1eccbba408572d9831797fbc351ec129dcf2b5dc9068c765a43687e`](https://preprod.cardanoscan.io/transaction/8e07a6a3c1eccbba408572d9831797fbc351ec129dcf2b5dc9068c765a43687e)

## How to Replicate

### Minswap V1 (Advanced Datum)

#### 1. Install Dependencies and Build the Package

```sh
pnpm install && pnpm run build
```

#### 2. Set `$SEED_PHRASE` Environment Variable

Note that this wallet needs to have some test ADA.

```sh
export SEED_PHRASE=$(cat ~/preprod_wallet.seed)
```

#### 3. Submit Your Swap Request

You can read more about how CLI interface in
[`smart-handles-agent`](https://github.com/Anastasia-Labs/smart-handles-agent) repository.

```sh
node dist/cli.js submit-advanced       \
  --lovelace 37000000                  \
  --owner $(cat ~/preprod_wallet.addr) \
  --router-fee 1000000                 \
  --reclaim-router-fee 0               \
  --extra-config extra.config.json
```

#### 4. (Optional) Switch to Another Wallet

This step is supposed to be performed by the routing agent.

```sh
export SEED_PHRASE=$(cat ~/preprod_wallet_2.seed)
```

#### 5. Run the Monitoring Endpoint of CLI

By monitoring the same instance of smart handles to which we just submitted a
route request, the application can perform the route to Minswap V1 address and
collect its 1 ADA router fee.

```sh
node dist/cli.js monitor
```
### Minswap V2 ADA-MIN Swap (Simple Datum)

#### 1. Follow Steps 1 & 2 from V1 Section

```sh
pnpm installpnpm run build

export SEED_PHRASE=$(cat ~/preprod_wallet.seed)
```

#### 2. Submit Your Swap Request

You can read more about how CLI interface in
[`smart-handles-agent`](https://github.com/Anastasia-Labs/smart-handles-agent) repository.

```sh
node dist/cli-v2.js submit-simple --lovelace 100000000
```

#### 4. (Optional) Switch to Another Wallet

This step is supposed to be performed by the routing agent.

```sh
export SEED_PHRASE=$(cat ~/preprod_wallet_2.seed)
```

#### 5. Run the Monitoring Endpoint of CLI

Very similar to V1 section above, only the build `.js` file is now `cli-v2.js`:

```sh
node dist/cli-v2.js monitor
```
