/**
 * Hardens the Gradle wrapper download during prebuild (EAS cloud builds).
 *
 * Two real failures on EAS, both while fetching the distribution:
 *   1) HTTP 504 from the gradle-distributions GitHub release redirect
 *   2) SocketTimeoutException — the wrapper's default networkTimeout is
 *      only 10000ms, so any 10s stall on the CDN kills the whole build
 *
 * Fixes applied to android/gradle/wrapper/gradle-wrapper.properties:
 *   - networkTimeout=60000 (wrapper waits up to 60s between reads)
 *   - -all.zip -> -bin.zip (runtime-only distribution, ~40% smaller
 *     download; sources/docs are not needed for CI builds)
 */

const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

module.exports = function withGradleDistribution(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const file = path.join(
        modConfig.modRequest.platformProjectRoot,
        'gradle',
        'wrapper',
        'gradle-wrapper.properties',
      );

      if (!fs.existsSync(file)) {
        console.warn(
          `[ABTIK] gradle-wrapper.properties not found at ${file} — skipping Gradle download hardening.`,
        );
        return modConfig;
      }

      let content = fs.readFileSync(file, 'utf8');

      // Smaller runtime-only distribution.
      content = content.replace(/(gradle-\d+\.\d+(?:\.\d+)?)-all\.zip/, '$1-bin.zip');

      // Longer read timeout (default 10s is what killed build #2).
      if (/^networkTimeout=.*$/m.test(content)) {
        content = content.replace(/^networkTimeout=.*$/m, 'networkTimeout=60000');
      } else {
        content = `${content.trimEnd()}\nnetworkTimeout=60000\n`;
      }

      fs.writeFileSync(file, content);
      console.log(
        '[ABTIK] Gradle wrapper hardened: networkTimeout=60000, -bin distribution.',
      );
      return modConfig;
    },
  ]);
};
