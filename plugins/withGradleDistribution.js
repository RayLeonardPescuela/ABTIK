/**
 * Hardens the Gradle wrapper download for EAS cloud builds.
 *
 * Observed failures on EAS, all while fetching the distribution:
 *   1) HTTP 504 from github.com/gradle/gradle-distributions/releases/...
 *      (services.gradle.org and downloads.gradle.org both redirect there;
 *      it served 504s to EAS's build region for 4 consecutive builds —
 *      the same URL downloads fine from other networks)
 *   2) SocketTimeoutException — the wrapper's default networkTimeout is only
 *      10000ms, so any 10s CDN stall kills the whole build
 *
 * Fixes applied to android/gradle/wrapper/gradle-wrapper.properties:
 *   - distributionUrl -> Tencent's gradle mirror for gradle versions whose
 *     official SHA-256 we have pinned (from https://gradle.org/release-checksums/).
 *     The wrapper verifies distributionSha256Sum after download, so the mirror
 *     is tamper-proof: wrong bytes fail the build instead of executing.
 *   - validateDistributionUrl=false (URL validation does not apply to mirrors)
 *   - networkTimeout=60000 (wrapper waits up to 60s between reads)
 *   - -all.zip -> -bin.zip (runtime-only distribution, ~40% smaller;
 *     sources/docs are not needed for CI builds)
 *   - gradle versions without a pinned checksum keep the official URL
 */

const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

// Official SHA-256 values from https://gradle.org/release-checksums/
// (only versions we have verified are eligible for the mirror).
const KNOWN_BIN_CHECKSUMS = {
  '8.10.2': '31c55713e40233a8303827ceb42ca48a47267a0ad4bab9177123121e71524c26',
};

// services.gradle.org / downloads.gradle.org redirect to GitHub releases,
// which has been serving 504s from EAS's build region.
const MIRROR_BASE = 'https://mirrors.cloud.tencent.com/gradle';

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
      const versionMatch = content.match(/gradle-(\d+\.\d+(?:\.\d+)?)-(?:all|bin)\.zip/);
      const version = versionMatch ? versionMatch[1] : null;
      const checksum = version ? KNOWN_BIN_CHECKSUMS[version] : undefined;

      if (checksum) {
        // Verified mirror: same bytes as the official distribution,
        // pinned by SHA-256 so the wrapper refuses anything else.
        const mirrorUrl = `${MIRROR_BASE.replace('://', '\\://')}/gradle-${version}-bin.zip`;
        content = content.replace(/^distributionUrl=.*$/m, `distributionUrl=${mirrorUrl}`);
        content = /^distributionSha256Sum=.*$/m.test(content)
          ? content.replace(/^distributionSha256Sum=.*$/m, `distributionSha256Sum=${checksum}`)
          : `${content.trimEnd()}\ndistributionSha256Sum=${checksum}\n`;
        content = /^validateDistributionUrl=.*$/m.test(content)
          ? content.replace(/^validateDistributionUrl=.*$/m, 'validateDistributionUrl=false')
          : `${content.trimEnd()}\nvalidateDistributionUrl=false\n`;
      } else {
        // Unknown version (future expo upgrade): keep the official URL,
        // just use the smaller runtime-only distribution.
        content = content.replace(/(gradle-\d+\.\d+(?:\.\d+)?)-all\.zip/, '$1-bin.zip');
      }

      // Longer read timeout (the wrapper default 10s killed one build).
      if (/^networkTimeout=.*$/m.test(content)) {
        content = content.replace(/^networkTimeout=.*$/m, 'networkTimeout=60000');
      } else {
        content = `${content.trimEnd()}\nnetworkTimeout=60000\n`;
      }

      fs.writeFileSync(file, content);
      console.log(
        checksum
          ? `[ABTIK] Gradle wrapper: mirror ${MIRROR_BASE} (sha256-pinned ${version}), networkTimeout=60000.`
          : `[ABTIK] Gradle wrapper hardened: networkTimeout=60000, -bin distribution (official URL).`,
      );
      return modConfig;
    },
  ]);
};
