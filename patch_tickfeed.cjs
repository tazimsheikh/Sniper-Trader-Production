const fs = require('fs');
let code = fs.readFileSync('server/trading/engine/TickFeed.ts', 'utf8');

code = code.replace(/const feed = this;/, "const feed = this;\n    const { profileContext } = require(\"../../utils/logger.js\");");

code = code.replace(/onSymbolPriceUpdated\(_instanceIndex: string, price: any\) \{\n\s*if \(\!feed.running\) return;\n\s*feed.processTick\(price\);\n\s*\}/, `onSymbolPriceUpdated(_instanceIndex: string, price: any) {\n        profileContext.run(feed.profileId, () => {\n          if (!feed.running) return;\n          feed.processTick(price);\n        });\n      }`);

code = code.replace(/onSymbolPricesUpdated\(_instanceIndex: string, prices: any\[\]\) \{\n\s*if \(\!feed.running\) return;\n\s*for \(const p of prices\) \{\n\s*feed.processTick\(p\);\n\s*\}\n\s*\}/, `onSymbolPricesUpdated(_instanceIndex: string, prices: any[]) {\n        profileContext.run(feed.profileId, () => {\n          if (!feed.running) return;\n          for (const p of prices) {\n            feed.processTick(p);\n          }\n        });\n      }`);

code = code.replace(/onDisconnected\(_instanceIndex: string\) \{\n\s*logger\.info\("\[TickFeed\] Streaming disconnected — switching to REST poll fallback\.",\);\n\s*if \(feed\.running && \!feed\.pollTimer\) feed\.startPollingFallback\(\);\n\s*\}/, `onDisconnected(_instanceIndex: string) {\n        profileContext.run(feed.profileId, () => {\n          logger.info(\"[TickFeed] Streaming disconnected — switching to REST poll fallback.\",);\n          if (feed.running && !feed.pollTimer) feed.startPollingFallback();\n        });\n      }`);

code = code.replace(/onConnected\(_instanceIndex: string, _replicas: number\) \{[\s\S]*?logger\.error\(`\[TickFeed\] Failed to fill gaps for \$\{pair\}:`,\n\s*e\.message,\);\n\s*\}\);\n\s*\}\n\s*\}\n\s*\}/, `onConnected(_instanceIndex: string, _replicas: number) {\n        profileContext.run(feed.profileId, () => {\n          logger.info(\"[TickFeed] ✅ Streaming reconnected — stopping poll fallback.\",);\n          if (feed.pollTimer) {\n            clearInterval(feed.pollTimer);\n            feed.pollTimer = null;\n          }\n\n          const orch = LiveOrchestrator.getInstance(feed.profileId);\n          if (orch) {\n            for (const pair of DiscretionaryTrader_PAIRS) {\n              orch.fillHistoryGaps(pair).catch((e) => {\n                logger.error(\`[TickFeed] Failed to fill gaps for \${pair}:\`,\n                  e.message,);\n              });\n            }\n          }\n        });\n      }`);

code = code.replace(/this\.pollTimer = setInterval\(async \(\) => \{/, `this.pollTimer = setInterval(() => {\n      profileContext.run(this.profileId, async () => {`);

code = code.replace(/logger\.error\("\[TickFeed\] Poll error:", err\.message\);\n\s*\}\n\s*\}, 60_000\);/, `logger.error("[TickFeed] Poll error:", err.message);\n      }\n      });\n    }, 60_000);`);

fs.writeFileSync('server/trading/engine/TickFeed.ts', code);
