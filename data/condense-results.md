_Raw introspection JSON vs. condensed digest. Measured with gpt-tokenizer (cl100k_base) as a proxy; reproduce with `npm run condense`._

| Subgraph | Raw JSON (tok) | Digest (tok) | vs raw | vs SDL | Entities |
| --- | ---: | ---: | ---: | ---: | ---: |
| gmx-avalanche | 332,998 | 13,728 | 24.3x | 6.8x | 25 |
| aave-v2-ethereum | 323,136 | 12,960 | 24.9x | 6.9x | 29 |
| aave-v3-base | 323,136 | 12,960 | 24.9x | 6.9x | 29 |
| aave-v2-polygon | 321,442 | 12,971 | 24.8x | 6.9x | 29 |
| aave-v3-ethereum | 321,442 | 12,971 | 24.8x | 6.9x | 29 |
| aave-v3-optimism | 321,442 | 12,971 | 24.8x | 6.9x | 29 |
| compound-v3-ethereum | 309,031 | 12,618 | 24.5x | 6.7x | 27 |
| compound-v3-base | 246,045 | 7,285 | 33.8x | 9.5x | 40 |
| compound-v3-polygon | 245,684 | 7,297 | 33.7x | 9.4x | 40 |
| pancakeswap-v3-ethereum | 221,057 | 9,839 | 22.5x | 6.3x | 24 |
| uniswap-v3-base-alt | 221,057 | 9,839 | 22.5x | 6.3x | 24 |
| sushiswap-v3-ethereum | 221,031 | 9,835 | 22.5x | 6.3x | 24 |
| makerdao-protofire | 168,079 | 4,281 | 39.3x | 10.6x | 30 |
| balancer-optimism-v2 | 167,132 | 2,134 | 78.3x | 20.8x | 26 |
| uniswap-v3-polygon-alt | 162,122 | 2,240 | 72.4x | 18.2x | 20 |
| uniswap-v3 | 161,647 | 2,553 | 63.3x | 16.0x | 23 |
| curve-finance-ethereum | 140,469 | 5,610 | 25.0x | 7.2x | 18 |
| ens-subgraph-v1 | 123,704 | 3,455 | 35.8x | 10.1x | 30 |
| ens-subgraph-v2 | 122,146 | 3,091 | 39.5x | 11.1x | 27 |
| sushiswap-polygon | 121,669 | 2,395 | 50.8x | 12.9x | 18 |
| uniswap-v4-base | 116,543 | 1,626 | 71.7x | 17.8x | 17 |
| uniswap-v4-bsc | 116,543 | 1,626 | 71.7x | 17.8x | 17 |
| pancakeswap-v2 | 86,276 | 1,317 | 65.5x | 16.7x | 15 |
| uniswap-v2-ethereum | 86,187 | 1,313 | 65.6x | 16.7x | 15 |
| sushiswap-mainnet | 84,393 | 1,223 | 69.0x | 17.7x | 15 |
| makerdao-governance | 76,646 | 1,777 | 43.1x | 11.5x | 16 |
| lido-ethereum | 68,445 | 3,405 | 20.1x | 5.8x | 11 |
| balancer-gauges-arbitrum | 61,461 | 2,045 | 30.1x | 8.8x | 16 |
| balancer-v3-sonic | 59,414 | 2,117 | 28.1x | 8.1x | 15 |
| uniswap-v4-ethereum | 7,469 | 246 | 30.4x | 7.5x | 1 |
