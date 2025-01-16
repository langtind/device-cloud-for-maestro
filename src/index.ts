import { setFailed, setOutput } from '@actions/core';
import { getParameters } from './methods/params';
import { spawn } from 'child_process';

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

    // Run the command as a child process
    const command = `npx --yes @devicecloud.dev/dcd cloud ${paramsString} --quiet`;
    console.info('Running command:', command);

    const child = spawn('npx', command.split(' '), { stdio: ['ignore', 'pipe', 'pipe'] });

    let commandOutput = '';
    let testResults = '';

    // Capture stdout incrementally
    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      commandOutput += chunk;

      // Extract relevant lines dynamically
      const filteredLines = chunk
        .split('\n')
        .filter((line) => line.includes('PASSED') || line.includes('FAILED'))
        .join('\n');
      testResults += filteredLines;
    });

    // Handle errors from stderr
    child.stderr.on('data', (data) => {
      console.error('Error stream:', data.toString());
    });

    // Handle process exit
    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`Command failed with exit code ${code}`);
        setFailed(`Command failed with exit code ${code}`);
        return;
      }

      console.info('Successfully completed test run.');
      console.log('Final logs:', commandOutput);

      // Set outputs
      setOutput('logs', commandOutput);
      setOutput('testResults', testResults.trim());
    });
  } catch (error) {
    if (typeof error === 'string') {
      setFailed(error);
    } else {
      setFailed((error as Error).message);
    }
  }
};

run();