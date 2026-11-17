import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { promisify } from 'node:util';
import type { Config } from './config.js';

const run = promisify(execFile);

export interface Server {
  check(...args: string[]): Promise<any>;
  forward(
    service: string,
    port: number,
    localPort: number,
  ): Promise<{ url: string; close(): void }>;
}

async function aws(config: Config, args: string[]): Promise<string> {
  const { stdout } = await run('aws', ['--region', config.region, ...args], {
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.trim();
}

const SAFE_ARG = /^[A-Za-z0-9@._:+-]{1,200}$/;

export function awsServer(config: Config, instanceName = 'pressroom-srv'): Server {
  let instanceId: string | undefined;
  const instance = async () => {
    instanceId ??= await aws(config, [
      'ec2',
      'describe-instances',
      '--filters',
      `Name=tag:Name,Values=${instanceName}`,
      'Name=instance-state-name,Values=running',
      '--query',
      'Reservations[0].Instances[0].InstanceId',
      '--output',
      'text',
    ]);
    if (!instanceId || instanceId === 'None') {
      throw new Error(`${instanceName} is not running`);
    }
    return instanceId;
  };

  const check = async (...args: string[]) => {
    for (const arg of args) {
      if (!SAFE_ARG.test(arg)) {
        throw new Error(`unsafe argument for the server check: ${arg}`);
      }
    }
    const id = await instance();
    const command = `/opt/pressroom/server/bin/golive-check.sh ${args.join(' ')}`;
    const commandId = await aws(config, [
      'ssm',
      'send-command',
      '--instance-ids',
      id,
      '--document-name',
      'AWS-RunShellScript',
      '--comment',
      'pressroom go-live check',
      '--parameters',
      JSON.stringify({ commands: [command] }),
      '--query',
      'Command.CommandId',
      '--output',
      'text',
    ]);
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const raw = await aws(config, [
        'ssm',
        'get-command-invocation',
        '--command-id',
        commandId,
        '--instance-id',
        id,
        '--output',
        'json',
      ]).catch(() => '');
      if (!raw) {
        continue;
      }
      const invocation = JSON.parse(raw);
      if (['Pending', 'InProgress', 'Delayed'].includes(invocation.Status)) {
        continue;
      }
      if (invocation.Status !== 'Success') {
        throw new Error(
          `server check ${args[0]} ${invocation.Status}: ${invocation.StandardErrorContent}`,
        );
      }
      const output = String(invocation.StandardOutputContent).trim();
      try {
        return JSON.parse(output);
      } catch {
        return output;
      }
    }
    throw new Error(`server check ${args[0]} timed out`);
  };

  const forward = async (service: string, port: number, localPort: number) => {
    const ip = String(await check('container-ip', service));
    const child: ChildProcess = spawn(
      'aws',
      [
        '--region',
        config.region,
        'ssm',
        'start-session',
        '--target',
        await instance(),
        '--document-name',
        'AWS-StartPortForwardingSessionToRemoteHost',
        '--parameters',
        JSON.stringify({
          host: [ip],
          portNumber: [String(port)],
          localPortNumber: [String(localPort)],
        }),
      ],
      { stdio: 'ignore' },
    );
    for (let attempt = 0; attempt < 60; attempt++) {
      const open = await new Promise<boolean>((resolve) => {
        const socket = connect(localPort, '127.0.0.1');
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('error', () => resolve(false));
      });
      if (open) {
        return { url: `http://127.0.0.1:${localPort}/mcp`, close: () => child.kill() };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    child.kill();
    throw new Error(
      `port forward to ${service}:${port} did not open (is session-manager-plugin installed?)`,
    );
  };

  return { check, forward };
}
