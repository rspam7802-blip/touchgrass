resource "aws_sns_topic" "alarms" {
  name              = "${local.name}-alarms"
  kms_master_key_id = aws_kms_key.main.id
}

resource "aws_sns_topic_subscription" "alarms_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarms = {
    # p95 latency targets from docs/PERFORMANCE.md (ALB target response time, seconds).
    api-p95-latency = {
      namespace  = "AWS/ApplicationELB", metric = "TargetResponseTime", stat = null, extended = "p95",
      threshold  = 0.3, comparison = "GreaterThanThreshold", periods = 5,
      dimensions = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
    }
    api-5xx = {
      namespace  = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", extended = null,
      threshold  = 50, comparison = "GreaterThanThreshold", periods = 3,
      dimensions = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
    }
    web-5xx = {
      namespace  = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", extended = null,
      threshold  = 20, comparison = "GreaterThanThreshold", periods = 3,
      dimensions = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.web.arn_suffix }
    }
    db-cpu = {
      namespace  = "AWS/RDS", metric = "CPUUtilization", stat = "Average", extended = null,
      threshold  = 75, comparison = "GreaterThanThreshold", periods = 5,
      dimensions = { DBInstanceIdentifier = aws_db_instance.main.identifier }
    }
    db-free-storage = {
      namespace  = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum", extended = null,
      threshold  = 20 * 1024 * 1024 * 1024, comparison = "LessThanThreshold", periods = 3,
      dimensions = { DBInstanceIdentifier = aws_db_instance.main.identifier }
    }
    db-replica-lag = {
      namespace  = "AWS/RDS", metric = "ReplicaLag", stat = "Maximum", extended = null,
      threshold  = 30, comparison = "GreaterThanThreshold", periods = 3,
      dimensions = { DBInstanceIdentifier = aws_db_instance.replica.identifier }
    }
    redis-memory = {
      namespace  = "AWS/ElastiCache", metric = "DatabaseMemoryUsagePercentage", stat = "Maximum", extended = null,
      threshold  = 75, comparison = "GreaterThanThreshold", periods = 3,
      dimensions = { ReplicationGroupId = aws_elasticache_replication_group.main.id }
    }
    redis-cpu = {
      namespace  = "AWS/ElastiCache", metric = "EngineCPUUtilization", stat = "Average", extended = null,
      threshold  = 70, comparison = "GreaterThanThreshold", periods = 5,
      dimensions = { ReplicationGroupId = aws_elasticache_replication_group.main.id }
    }
    worker-running = {
      namespace  = "ECS/ContainerInsights", metric = "RunningTaskCount", stat = "Minimum", extended = null,
      threshold  = 1, comparison = "LessThanThreshold", periods = 3,
      dimensions = { ClusterName = aws_ecs_cluster.main.name, ServiceName = "worker" }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "main" {
  for_each            = local.alarms
  alarm_name          = "${local.name}-${each.key}"
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.stat
  extended_statistic  = each.value.extended
  period              = 60
  evaluation_periods  = each.value.periods
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  dimensions          = each.value.dimensions
  treat_missing_data  = each.key == "worker-running" ? "breaching" : "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}
