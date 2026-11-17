import * as dlm from 'aws-cdk-lib/aws-dlm';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { SNAPSHOT_TAG } from './config.js';

export const SNAPSHOTS_KEPT = 7;

export class Snapshots extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('dlm.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSDataLifecycleManagerServiceRole',
        ),
      ],
    });
    new dlm.CfnLifecyclePolicy(this, 'Policy', {
      description: 'Daily snapshots of the PressRoom server',
      state: 'ENABLED',
      executionRoleArn: role.roleArn,
      policyDetails: {
        policyType: 'EBS_SNAPSHOT_MANAGEMENT',
        resourceTypes: ['INSTANCE'],
        targetTags: [{ key: SNAPSHOT_TAG.key, value: SNAPSHOT_TAG.value }],
        schedules: [
          {
            name: 'daily',
            copyTags: true,
            createRule: { interval: 24, intervalUnit: 'HOURS', times: ['05:00'] },
            retainRule: { count: SNAPSHOTS_KEPT },
          },
        ],
      },
    });
  }
}
