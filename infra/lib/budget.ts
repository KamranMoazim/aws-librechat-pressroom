import * as budgets from 'aws-cdk-lib/aws-budgets';
import { Construct } from 'constructs';
import { PROJECT } from './config.js';

export interface BudgetProps {
  alertEmail: string;
}

export const MONTHLY_BUDGET_USD = 25;

export class Budget extends Construct {
  constructor(scope: Construct, id: string, props: BudgetProps) {
    super(scope, id);

    const subscribers = [{ subscriptionType: 'EMAIL', address: props.alertEmail }];
    new budgets.CfnBudget(this, 'Budget', {
      budget: {
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: MONTHLY_BUDGET_USD, unit: 'USD' },
        costFilters: { TagKeyValue: [`user:project$${PROJECT}`] },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers,
        },
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers,
        },
      ],
    });
  }
}
