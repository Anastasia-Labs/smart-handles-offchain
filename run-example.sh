# Uncomment and add appropriate values:
#
# export BLOCKFROST_KEY="YOUR PREPROD BLOCKFROST KEY"
# export SEED_PHRASE="WALLET SEED PHRASE OF THE USER"
# export ROUTING_SEED_PHRASE="WALLET SEED PHRASE OF THE ROUTING AGENT"

example="ada-to-min" # or "min-to-tbtc"

tsc example/$example.ts       \
  --target esnext             \
  --module nodenext           \
  --moduleResolution nodenext \
  --resolveJsonModule

node example/$example.js
