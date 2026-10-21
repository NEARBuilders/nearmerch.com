const fs = require("node:fs");
const path = require("node:path");
const { EveryPluginDevServer } = require("every-plugin/build/rspack");
const { withZephyr } = require("zephyr-rspack-plugin");
const pkg = require("./package.json");

const shouldDeploy = process.env.DEPLOY === 'true';

function updateHostConfig(name, url) {
  try {
    const configPath = path.resolve(__dirname, "../bos.config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

    if (config.app.api.name !== name) {
      console.error(`   ❌ API "${name}" not found in bos.config.json`);
      return;
    }

    config.app.api.production = url;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    console.log(`   ✅ Updated bos.config.json: app.api.production`);
  } catch (err) {
    console.error("   ❌ Failed to update bos.config.json:", err.message);
  }
}

const baseConfig = {
  externals: [
    /^@libsql\/.*/,
  ],
  // Resend optionally imports this only for React email templates.
  // We send text bodies, so the import never runs; keep it unbundled
  // without pretending the package exists at runtime.
  ignoreWarnings: [
    { module: /resend/, message: /Can't resolve '@react-email\/render'/ },
  ],
  plugins: [new EveryPluginDevServer()],
  infrastructureLogging: {
    level: 'error',
  },
  stats: 'errors-warnings',
};

module.exports = shouldDeploy
  ? withZephyr({
      hooks: {
        onDeployComplete: (info) => {
          console.log("🚀 API Deployed:", info.url);
          updateHostConfig(pkg.name, info.url);
        },
      },
    })(baseConfig)
  : baseConfig;
