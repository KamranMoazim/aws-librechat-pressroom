import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export interface MonitoringProps {
  instance: ec2.Instance;
  alertEmail: string;
}

export const HEALTH_NAMESPACE = 'PressRoom';

interface AlarmSpec {
  id: string;
  description: string;
  metric: cloudwatch.Metric;
  threshold: number;
  comparison: cloudwatch.ComparisonOperator;
  periods: number;
}

export class Monitoring extends Construct {
  readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);
    this.topic = new sns.Topic(this, 'Alerts', { topicName: 'pressroom-alerts' });
    this.topic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));

    const instanceId = props.instance.instanceId;
    const fiveMinutes = Duration.minutes(5);
    const agent = (metricName: string, extra: Record<string, string> = {}) =>
      new cloudwatch.Metric({
        namespace: 'CWAgent',
        metricName,
        dimensionsMap: { InstanceId: instanceId, ...extra },
        statistic: 'Maximum',
        period: fiveMinutes,
      });
    const health = (metricName: string, statistic = 'Maximum') =>
      new cloudwatch.Metric({
        namespace: HEALTH_NAMESPACE,
        metricName,
        dimensionsMap: { InstanceId: instanceId },
        statistic,
        period: fiveMinutes,
      });
    const above = cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD;

    const specs: AlarmSpec[] = [
      {
        id: 'Disk',
        description: 'Root disk over 80% full',
        metric: agent('disk_used_percent', { path: '/', fstype: 'ext4' }),
        threshold: 80,
        comparison: above,
        periods: 2,
      },
      {
        id: 'Memory',
        description: 'Memory over 90% used for 15 minutes',
        metric: agent('mem_used_percent'),
        threshold: 90,
        comparison: above,
        periods: 3,
      },
      {
        id: 'BackupAge',
        description: 'Last successful backup is older than 26 hours',
        metric: health('BackupAgeHours'),
        threshold: 26,
        comparison: above,
        periods: 1,
      },
      {
        id: 'CertExpiry',
        description: 'TLS certificate expires in under 14 days',
        metric: health('CertDaysLeft', 'Minimum'),
        threshold: 14,
        comparison: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        periods: 1,
      },
      {
        id: 'ApiRestarts',
        description: 'LibreChat api container restarted',
        metric: health('ApiRestarts', 'Sum'),
        threshold: 0,
        comparison: above,
        periods: 1,
      },
      {
        id: 'Unhealthy',
        description: 'A container is stopped or unhealthy for 15 minutes',
        metric: health('UnhealthyContainers'),
        threshold: 0,
        comparison: above,
        periods: 3,
      },
      {
        id: 'StatusCheck',
        description: 'EC2 status check failing',
        metric: new cloudwatch.Metric({
          namespace: 'AWS/EC2',
          metricName: 'StatusCheckFailed',
          dimensionsMap: { InstanceId: instanceId },
          statistic: 'Maximum',
          period: fiveMinutes,
        }),
        threshold: 0,
        comparison: above,
        periods: 2,
      },
    ];

    const action = new actions.SnsAction(this.topic);
    for (const spec of specs) {
      const alarm = new cloudwatch.Alarm(this, spec.id, {
        alarmName: `pressroom-${spec.id.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
        alarmDescription: spec.description,
        metric: spec.metric,
        threshold: spec.threshold,
        comparisonOperator: spec.comparison,
        evaluationPeriods: spec.periods,
        // A paused build server sends nothing; the status check alarm covers a dead instance.
        treatMissingData: cloudwatch.TreatMissingData.MISSING,
      });
      alarm.addAlarmAction(action);
      alarm.addOkAction(action);
    }
  }
}
