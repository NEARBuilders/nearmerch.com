import fs from "node:fs";
import path from "node:path";
import { ModuleFederationPlugin } from "@module-federation/enhanced/rspack";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import DrizzleORMMigrations from "@proj-airi/unplugin-drizzle-orm-migrations/rspack";
import { withZephyr } from "zephyr-rsbuild-plugin";

const __dirname = import.meta.dirname;
const shouldDeploy = process.env.DEPLOY === "true";

const configPath =
  process.env.BOS_CONFIG_PATH ?? path.resolve(__dirname, "../bos.config.json");

const bosConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
const sharedUi = bosConfig.shared?.ui ?? {};

function updateBosConfig(url: string) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.app.host.production = url;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`   ✅ Updated bos.config.json: app.host.production`);
  } catch (err) {
    console.error(
      "   ❌ Failed to update bos.config.json:",
      (err as Error).message
    );
  }
}

// Drizzle's unplugin load rule uses type: javascript/auto without a filter, so
// Rspack otherwise parses bundled JSON (e.g. ajv schemas from @x402) as JS.
function excludeJsonFromUnpluginLoad() {
  return {
    name: "exclude-json-from-unplugin-load",
    apply(compiler: {
      hooks: { afterEnvironment: { tap: (name: string, fn: () => void) => void } };
      options: { module: { rules: Array<Record<string, unknown>> } };
    }) {
      compiler.hooks.afterEnvironment.tap("exclude-json-from-unplugin-load", () => {
        for (const rule of compiler.options.module.rules) {
          const rawUse = rule.use;
          const uses = (
            Array.isArray(rawUse) ? rawUse : rawUse ? [rawUse] : []
          ) as Array<{ loader?: string }>;
          const isUnpluginLoad = uses.some(
            (use) =>
              typeof use.loader === "string" &&
              use.loader.includes("unplugin") &&
              use.loader.includes("loaders/load"),
          );
          if (!isUnpluginLoad) continue;

          const prevInclude = rule.include;
          rule.include = (id: string) => {
            if (id.endsWith(".json")) return false;
            return typeof prevInclude === "function"
              ? (prevInclude as (resource: string) => boolean)(id)
              : true;
          };
        }
      });
    },
  };
}

const plugins = [pluginReact()];

if (shouldDeploy) {
  plugins.push(
    withZephyr({
      hooks: {
        onDeployComplete: (info: { url: string }) => {
          console.log("🚀 Host Deployed:", info.url);
          updateBosConfig(info.url);
        },
      },
    })
  );
}

export default defineConfig({
  plugins,
  source: {
    entry: {
      index: "./src/program.ts",
    },
  },
  resolve: {
    alias: {
      "@": "./src",
    },
  },
  dev: {
    progressBar: false,
  },
  tools: {
    rspack: {
      target: "async-node",
      optimization: {
        nodeEnv: false,
      },
      output: {
        uniqueName: "host",
        library: { type: "commonjs-module" },
      },
      module: {
        rules: [
          // Embed skills/nearmerch/SKILL.md?raw as a string for GET /skill.md.
          // Rsbuild only handles ?raw for JS, CSS, JSON and asset files.
          { test: /\.md$/, resourceQuery: /raw/, type: "asset/source" },
        ],
      },
      externals: [
        /^node:/,
        /^bun:/,
        "@libsql/client",
      ],
      ignoreWarnings: [
        {
          module: /@x402\/core/,
          message:
            /Critical dependency: require function is used in a way in which dependencies cannot be statically extracted/,
        },
        {
          module: /resend/,
          message: /Can't resolve '@react-email\/render'/,
        },
      ],
      infrastructureLogging: {
        level: "error",
      },
      stats: "errors-warnings",
      plugins: [
        DrizzleORMMigrations(),
        excludeJsonFromUnpluginLoad(),
        new ModuleFederationPlugin({
          name: "host",
          filename: "remoteEntry.js",
          dts: false,
          runtimePlugins: [require.resolve("@module-federation/node/runtimePlugin")],
          library: { type: "commonjs-module" },
          exposes: {
            "./Server": "./src/program.ts",
          },
          shared: sharedUi,
        }),
      ],
    },
  },
  output: {
    minify: false,
    distPath: {
      root: "dist",
    },
    assetPrefix: "/",
    filename: {
      js: "[name].js",
    },
  },
});
