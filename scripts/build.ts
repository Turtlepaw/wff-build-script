// scripts/build-watchface.ts
import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import inquirer from "inquirer";
import chalk from "chalk"; // For colored text

const params: Record<string, string[]> = {
  debug: ["-d", "--debug"],
  release: ["-r", "--release"],
  all: ["-a", "--all"],
};

// Custom spinner function
async function progressIndicator(taskName: string) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frameIndex = 0;
  let intervalId: NodeJS.Timeout;

  // Function to animate the spinner
  const animate = () => {
    process.stdout.write(`\r${chalk.cyan(frames[frameIndex])} ${taskName}`); // Overwrite the line with each frame
    frameIndex = (frameIndex + 1) % frames.length; // Cycle through frames
  };

  // Start the spinner
  intervalId = setInterval(animate, 80);

  // Stop method
  function stop(isSuccess = true) {
    clearInterval(intervalId); // Stop the spinner
    process.stdout.write(
      `\r${isSuccess ? chalk.green("✓") : chalk.red("✘")} ${taskName}\n`
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Return stop method for external usage
  return { stop };
}

async function main() {
  const env = process.env;
  let watchFaceId = env.WATCHFACE_ID;
  const debugMode = process.argv.some((arg) => params.debug.includes(arg));
  const releaseMode = process.argv.some((arg) => params.release.includes(arg));
  const allDevices = process.argv.some((arg) => params.all.includes(arg));

  if (debugMode) {
    console.log("Debug mode enabled.");
    // debug spinner
    const spinner = await progressIndicator("Debugging...");
    // hold for 5 seconds
    await new Promise((resolve) => setTimeout(resolve, 5000));
    spinner.stop(true);
  }

  // Determine watchface ID
  if (!watchFaceId) {
    const buildGradlePath = path.resolve("watchface/build.gradle.kts");
    if (fs.existsSync(buildGradlePath)) {
      const gradleContent = fs.readFileSync(buildGradlePath, "utf8");
      const match = gradleContent.match(/applicationId\s*=\s*"(.*?)"/);
      if (match) {
        watchFaceId = match[1];
      } else {
        console.error(
          "Can't determine watchFaceId: check watchface/build.gradle.kts"
        );
        process.exit(9);
      }
    } else {
      console.error("Can't find build.gradle.kts file.");
      process.exit(9);
    }
  }

  // Set environment variables
  if (!env.JAVA_HOME || !env.ANDROID_HOME) {
    const setEnvPath = path.resolve("..", "wff-build-tools", "set-env.bat");
    if (!fs.existsSync(setEnvPath)) {
      console.error("Error: set-env.bat not found.");
      process.exit(10);
    }
    spawnSync("cmd", ["/c", setEnvPath], { stdio: "inherit" });
  }

  if (!env.JAVA_HOME || !env.ANDROID_HOME) {
    console.error(
      "Environment variables JAVA_HOME or ANDROID_HOME are not set."
    );
    process.exit(7);
  }

  const adbExe = path.join(env.ANDROID_HOME!, "platform-tools", "adb");
  if (debugMode) {
    console.log(`adbExe: ${adbExe}`);
  }

  // Preprocessing
  const preprocessScript = path.resolve(
    "..",
    "wff-build-tools",
    "preprocess.py"
  );
  if (!fs.existsSync(preprocessScript)) {
    const answer = await inquirer.prompt([
      {
        type: "confirm",
        name: "download-preprocessor",
        message: "Preprocessor script not found. Download now?",
        default: false,
      },
    ]);

    if (answer["download-preprocessor"]) {
      const spinner = await progressIndicator(
        "Downloading preprocessor script..."
      );
      try {
        // Create dir if not exists
        if (!fs.existsSync(path.dirname(preprocessScript))) {
          fs.mkdirSync(path.dirname(preprocessScript), { recursive: true });
        }

        execSync(
          `curl -o ${preprocessScript} https://raw.githubusercontent.com/gondwanasoft/xml-preprocessor/main/preprocess.py`,
          { stdio: "inherit" }
        );
        spinner.stop(true);
      } catch {
        spinner.stop(false);
        console.error("Download failed.");
        process.exit(6);
      }
    } else {
      console.error("Preprocessor script not downloaded.");
      //process.exit(6); // WFF preprocessor isn't required
    }
  }

  const spinner = await progressIndicator("Preprocessing...");
  try {
    execSync(
      `python ${preprocessScript} watchface/watchface-pp.xml watchface/src/main/res/raw/watchface.xml -y ${
        debugMode ? "-d" : ""
      }`,
      { stdio: "inherit" }
    );

    spinner.stop(true);
  } catch {
    spinner.stop(false);
    console.error("Preprocessor error; build stopped.");
    process.exit(1);
  }

  // Validation
  const validatorJar = path.resolve(
    "..",
    "wff-build-tools",
    "dwf-format-2-validator-1.0.jar"
  );

  if (!fs.existsSync(validatorJar)) {
    const answer = await inquirer.prompt([
      {
        type: "confirm",
        name: "download-validator",
        message: "Validator not found. Download from latest GitHub release?",
        default: false,
      },
    ]);

    if (answer["download-validator"]) {
      const spinner = await progressIndicator(
        "Downloading validator from https://github.com/google/watchface..."
      );
      try {
        // Create dir if not exists
        if (!fs.existsSync(path.dirname(validatorJar))) {
          fs.mkdirSync(path.dirname(validatorJar), { recursive: true });
        }

        execSync(
          `curl -L -o ${validatorJar} https://github.com/google/watchface/releases/download/latest/dwf-format-2-validator-1.0.jar`,
          { stdio: "inherit" }
        );
        spinner.stop(true);
      } catch {
        spinner.stop(false);
        console.error("Download failed.");
        process.exit(6);
      }
    } else {
      console.error("Validator not downloaded, no watch face validation.");
    }
  }

  if (fs.existsSync(validatorJar)) {
    const spinner = await progressIndicator("Validating...");
    try {
      execSync(
        `"${env.JAVA_HOME}\\bin\\java" -jar "${validatorJar}" 2 watchface/src/main/res/raw/watchface.xml 2> validation.txt`,
        { stdio: "inherit" }
      );
      const validationResult = fs.readFileSync("validation.txt", "utf8");
      if (!validationResult.includes("PASSED")) {
        spinner.stop(false);
        console.error("Validation failed:");
        console.log(validationResult);
        process.exit(3);
      }
      fs.unlinkSync("validation.txt");
      spinner.stop(true);
    } catch {
      spinner.stop(false);
      console.error("Validation error.");
      process.exit(3);
    }
  } else {
    console.log("Skipping validation: Validator JAR not found.");
  }

  // Build
  console.log("Building...");
  const task = releaseMode ? "bundleRelease" : "assembleDebug";
  try {
    execSync(`gradlew ${task}`, { stdio: "inherit" });
  } catch {
    console.error("Build error!");
    process.exit(2);
  }

  // Run separately to avoid exiting prematurely
  await (async () => {
    if (releaseMode) {
      const memoryTool = path.resolve(
        "..",
        "wff-build-tools",
        "memory-footprint.jar"
      );

      if (!fs.existsSync(memoryTool)) {
        const answer = await inquirer.prompt([
          {
            type: "confirm",
            name: "download-memory-tool",
            message:
              "Memory footprint tool not found. Download from latest GitHub release?",
            default: false,
          },
        ]);

        if (answer["download-memory-tool"]) {
          const spinner = await progressIndicator(
            "Downloading memory footprint tool from https://github.com/google/watchface..."
          );
          try {
            // Create dir if not exists
            if (!fs.existsSync(path.dirname(memoryTool))) {
              fs.mkdirSync(path.dirname(memoryTool), { recursive: true });
            }

            execSync(
              `curl -L -o ${memoryTool} https://github.com/google/watchface/releases/download/latest/memory-footprint.jar`,
              { stdio: "inherit" }
            );
            spinner.stop(true);
          } catch {
            spinner.stop(false);
            console.error("Download failed.");
            process.exit(6);
          }
        } else {
          console.error("Validator not downloaded, no watch face validation.");
          return;
        }
      }

      const spinner = await progressIndicator("Checking memory footprint...");

      try {
        execSync(
          `"${env.JAVA_HOME}\\bin\\java" -jar "${memoryTool}" --watch-face watchface/build/outputs/bundle/release/watchface-release.aab --schema-version 2 --ambient-limit-mb 10 --active-limit-mb 100 --apply-v1-offload-limitations --estimate-optimization --report --verbose`,
          { stdio: "inherit" }
        );
        spinner.stop(true);
      } catch {
        spinner.stop(false);
        console.error("Memory footprint check failed.");
      }
      return;
    }
  })();

  async function checkIfWearOS(deviceId: string) {
    try {
      // Get the device's system property for `ro.build.characteristics`
      const result = execSync(
        `${adbExe} -s ${deviceId} shell getprop ro.build.characteristics`
      )
        .toString()
        .trim();

      // If the property contains "watch", it's a Wear OS device
      return result.includes("watch");
    } catch (error) {
      console.error("Error checking device properties:", error);
      return false;
    }
  }

  // Installation
  console.log("Installing...");
  const devicesResult = execSync(`${adbExe} devices`)
    .toString()
    .trim()
    .split("\n")
    .slice(1);
  const devices = devicesResult
    .filter((line) => line && !line.includes("offline"))
    .map((line) => line.split("\t")[0]);

  if (devices.length === 0) {
    console.error("No devices connected!");
    process.exit(5);
  }

  const compatibleDevices = await Promise.all(
    devices.map(async (device) => {
      return await checkIfWearOS(device);
    })
  );

  let targetDevice = devices[0];
  if (devices.length > 1) {
    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "device",
        message: "Multiple devices found. Please select a device:",
        choices: devices.map((device, index) => ({
          name: `Device ${index + 1}: ${device}${
            compatibleDevices[index] ? "" : " (incompatible)"
          }`,
          value: device,
          disabled: !compatibleDevices[index] && !allDevices,
        })),
      },
    ]);
    targetDevice = answers.device;
  }

  try {
    execSync(
      `${adbExe} -s ${targetDevice} install watchface/build/outputs/apk/debug/watchface-debug.apk`,
      { stdio: "inherit" }
    );
    execSync(
      `${adbExe} -s ${targetDevice} shell am broadcast -a com.google.android.wearable.app.DEBUG_SURFACE --es operation set-watchface --es watchFaceId ${watchFaceId}`,
      { stdio: "inherit" }
    );
    console.log("Installation complete.");
  } catch (error) {
    console.error("Installation failed.");
    process.exit(5);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});