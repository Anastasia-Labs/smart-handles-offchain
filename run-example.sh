export BLOCKFROST_KEY="YOUR PREPROD BLOCKFROST KEY"
export SEED_PHRASE="WALLET SEED PHRASE OF THE USER"
export ROUTING_SEED_PHRASE="WALLET SEED PHRASE OF THE ROUTING AGENT"

tsc example/index.ts --target esnext --module nodenext --moduleResolution nodenext --resolveJsonModule
node example/index.js
