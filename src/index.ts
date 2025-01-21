import { setFailed, setOutput } from '@actions/core';
import { getParameters } from './methods/params';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const escapeShellValue = (value: string): string => {
  return value.replace(/(["\\'$`!\s])/g, '\\$1');
};

const run = async (): Promise<void> => {
  try {
    const {
      additionalAppBinaryIds,
      additionalAppFiles,
      androidApiLevel,
      androidDevice,
      apiKey,
      apiUrl,
      appBinaryId,
      appFilePath,
      async,
      deviceLocale,
      downloadArtifacts,
      env,
      excludeFlows,
      excludeTags,
      googlePlay,
      includeTags,
      iOSVersion,
      iosDevice,
      maestroVersion,
      name,
      orientation,
      retry,
      workspaceFolder,
    } = await getParameters();

    const params: Record<string, any> = {
      'additional-app-binary-ids': additionalAppBinaryIds,
      'additional-app-files': additionalAppFiles,
      'android-api-level': androidApiLevel,
      'android-device': androidDevice,
      'api-key': apiKey,
      'api-url': apiUrl,
      'app-binary-id': appBinaryId,
      'app-file': appFilePath,
      async,
      'device-locale': deviceLocale,
      'download-artifacts': downloadArtifacts,
      'exclude-flows': excludeFlows,
      'exclude-tags': excludeTags,
      flows: workspaceFolder,
      'google-play': googlePlay,
      'include-tags': includeTags,
      'ios-device': iosDevice,
      'ios-version': iOSVersion,
      'maestro-version': maestroVersion,
      name,
      orientation,
      retry,
    };

    let paramsString = Object.keys(params).reduce((acc, key) => {
      if (!params[key]) return acc;
      const value =
        typeof params[key] === 'string'
          ? escapeShellValue(params[key])
          : params[key];
      return `${acc} --${key} ${value}`;
    }, '');

    if (env && env.length > 0) {
      env.forEach((e) => {
        let [key, ...rest] = e.split('=');
        let value = rest.join('=');
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        paramsString += ` --env ${key}=${escapeShellValue(value)}`;
      });
    }

    // Define temporary files for logs
    const logFilePath = path.join(os.tmpdir(), 'command_output.log');
    const testResultsFilePath = path.join(os.tmpdir(), 'test_results.log');

    // Run the command as a child process
    const command = `npx --yes @devicecloud.dev/dcd cloud ${paramsString} --quiet`;
    console.info(`[${new Date().toISOString()}] Running command:`, command);
    console.info(`[${new Date().toISOString()}] Starting test run`);

    const child = spawn('npx', command.split(' '), { stdio: ['ignore', 'pipe', 'pipe'] });

    // Add periodic health check logging
    const healthCheckInterval = setInterval(() => {
      console.info(`[${new Date().toISOString()}] Process still running, pid: ${child.pid}`);
    }, 5 * 60 * 1000); // Log every 5 minutes

    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    const testResultsStream = fs.createWriteStream(testResultsFilePath, { flags: 'a' });

    let lastDataReceived = Date.now();
    let totalBytesReceived = 0;

    logStream.on('error', (error) => {
      console.error(`[${new Date().toISOString()}] Log stream error:`, error);
      console.error('Last data received:', new Date(lastDataReceived).toISOString());
      console.error('Total bytes received:', totalBytesReceived);
      child.kill();
      setFailed(`Log stream error: ${error.message}`);
    });

    testResultsStream.on('error', (error) => {
      console.error(`[${new Date().toISOString()}] Test results stream error:`, error);
      console.error('Last data received:', new Date(lastDataReceived).toISOString());
      console.error('Total bytes received:', totalBytesReceived);
      child.kill();
      setFailed(`Test results stream error: ${error.message}`);
    });

    child.stdout.on('data', (data) => {
      lastDataReceived = Date.now();
      totalBytesReceived += data.length;
      console.debug(`[${new Date().toISOString()}] Received ${data.length} bytes of data`);

      const chunk = data.toString();
      logStream.write(chunk);

      const filteredLines = chunk
        .split('\n')
        .filter((line: string) => line.includes('PASSED') || line.includes('FAILED'))
        .join('\n');
      if (filteredLines) {
        console.info(`[${new Date().toISOString()}] New test results received:`, filteredLines);
      }
      testResultsStream.write(filteredLines + '\n');
    });

    child.stderr.on('data', (data) => {
      console.error(`[${new Date().toISOString()}] Error stream:`, data.toString());
    });

    child.on('error', (error) => {
      console.error(`[${new Date().toISOString()}] Process error:`, error);
      console.error('Last data received:', new Date(lastDataReceived).toISOString());
      console.error('Total bytes received:', totalBytesReceived);
      clearInterval(healthCheckInterval);
      setFailed(`Process error: ${error.message}`);
    });

    child.on('close', (code) => {
      const endTime = new Date().toISOString();
      console.info(`[${endTime}] Process closed with code ${code}`);
      console.info('Last data received:', new Date(lastDataReceived).toISOString());
      console.info('Total bytes received:', totalBytesReceived);
      console.info('Time since last data:', Date.now() - lastDataReceived, 'ms');

      clearInterval(healthCheckInterval);

      logStream.end();
      testResultsStream.end();

      if (code !== 0) {
        console.error(`[${endTime}] Command failed with exit code ${code}`);
        setFailed(`Command failed with exit code ${code}`);
        return;
      }

      console.info('Successfully completed test run.');

      try {
        // Read logs and results from files
        const commandOutput = fs.readFileSync(logFilePath, 'utf-8');
        const testResults = fs.readFileSync(testResultsFilePath, 'utf-8');

        console.log('Final logs:', commandOutput);
        console.log('Test results:', testResults);

        // Set outputs
        setOutput('logs', commandOutput);
        setOutput('testResults', testResults.trim());
      } catch (error) {
        console.error('Error reading output files:', error);
        setFailed(`Error reading output files: ${(error as Error).message}`);
      }
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Unexpected error:`, error);
    if (typeof error === 'string') {
      setFailed(error);
    } else {
      setFailed((error as Error).message);
    }
  }
};

run();
