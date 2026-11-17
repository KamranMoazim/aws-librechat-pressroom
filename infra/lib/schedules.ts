import { Stack } from 'aws-cdk-lib';
import type * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import { Construct } from 'constructs';

export interface SchedulesProps {
  instance: ec2.Instance;
}

export const SPEND_REPORT_CRON = 'cron(0 6 1 * ? *)';

export class Schedules extends Construct {
  constructor(scope: Construct, id: string, props: SchedulesProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const documentArn = stack.formatArn({
      service: 'ssm',
      account: '',
      resource: 'document',
      resourceName: 'AWS-RunShellScript',
    });
    const instanceArn = stack.formatArn({
      service: 'ec2',
      resource: 'instance',
      resourceName: props.instance.instanceId,
    });

    const role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {
        conditions: { StringEquals: { 'aws:SourceAccount': stack.account } },
      }),
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:SendCommand'],
        resources: [documentArn, instanceArn],
      }),
    );

    new scheduler.CfnSchedule(this, 'SpendReport', {
      name: 'pressroom-spend-report',
      description: 'Monthly spend CSV to the backup bucket, then purge transactions past 13 months',
      scheduleExpression: SPEND_REPORT_CRON,
      scheduleExpressionTimezone: 'UTC',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: 'arn:aws:scheduler:::aws-sdk:ssm:sendCommand',
        roleArn: role.roleArn,
        input: stack.toJsonString({
          DocumentName: 'AWS-RunShellScript',
          InstanceIds: [props.instance.instanceId],
          Comment: 'pressroom spend report',
          Parameters: { commands: ['PURGE=1 /opt/pressroom/server/bin/spend-report.sh'] },
        }),
        retryPolicy: { maximumRetryAttempts: 3, maximumEventAgeInSeconds: 3600 },
      },
    });
  }
}
