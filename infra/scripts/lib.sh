REGION="${AWS_REGION:-us-east-1}"

instance_id()
{
  aws ec2 describe-instances --region "$REGION" \
    --filters Name=tag:Name,Values=pressroom-srv Name=instance-state-name,Values=pending,running,stopping,stopped \
    --query 'Reservations[0].Instances[0].InstanceId' --output text
}
