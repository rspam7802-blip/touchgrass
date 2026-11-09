resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "service" {
  for_each          = toset(["api", "realtime", "worker", "migrate", "web", "otel"])
  name              = "/touchgrass/${var.environment}/${each.key}"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.main.arn
}

resource "aws_cloudwatch_log_group" "vpc_flow" {
  name              = "/touchgrass/${var.environment}/vpc-flow"
  retention_in_days = 14
  kms_key_id        = aws_kms_key.main.arn
}

locals {
  api_image = "${aws_ecr_repository.app["api"].repository_url}:${var.image_tag}"
  web_image = "${aws_ecr_repository.app["web"].repository_url}:${var.image_tag}"

  # Plain configuration shared by api, realtime, worker and migrate; secrets come from Secrets Manager.
  app_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "APP_VERSION", value = var.image_tag },
    { name = "LOG_LEVEL", value = "info" },
    { name = "API_PORT", value = "4000" },
    { name = "API_WORKERS", value = tostring(floor(var.api_cpu / 1024)) },
    { name = "REALTIME_PORT", value = "4001" },
    { name = "API_PUBLIC_URL", value = "https://${local.api}" },
    { name = "WEB_PUBLIC_URL", value = "https://${var.domain}" },
    { name = "CORS_ORIGINS", value = "https://${var.domain}" },
    { name = "TRUST_PROXY_HOPS", value = "1" },
    { name = "DATABASE_POOL_MAX", value = "20" },
    { name = "MIN_SUPPORTED_APP_VERSION", value = var.min_supported_app_version },
    { name = "LATEST_APP_VERSION", value = var.latest_app_version },
    { name = "SMS_PROVIDER", value = "msg91" },
    { name = "PAYMENTS_PROVIDER", value = "razorpay" },
    { name = "PUSH_PROVIDER", value = "expo" },
    { name = "STORAGE_PROVIDER", value = "s3" },
    { name = "S3_REGION", value = var.region },
    { name = "S3_BUCKET_MEDIA", value = aws_s3_bucket.media.bucket },
    { name = "S3_FORCE_PATH_STYLE", value = "false" },
    { name = "MEDIA_PUBLIC_BASE_URL", value = "https://${local.media}" },
    { name = "MAPS_PROVIDER", value = "google" },
    { name = "WEATHER_PROVIDER", value = "openweather" },
    { name = "MODERATION_PROVIDER", value = "rekognition" },
    { name = "AWS_REGION", value = var.region },
    { name = "ANALYTICS_PROVIDER", value = "posthog" },
    { name = "POSTHOG_HOST", value = "https://eu.i.posthog.com" },
    { name = "EMAIL_PROVIDER", value = "ses" },
    { name = "EMAIL_FROM", value = "TouchGrass <hello@${var.domain}>" },
    { name = "SELLER_LEGAL_NAME", value = var.seller_legal_name },
    { name = "SELLER_GSTIN", value = var.seller_gstin },
    { name = "OTEL_EXPORTER_OTLP_ENDPOINT", value = "http://localhost:4318" },
  ]

  # AWS Distro for OpenTelemetry sidecar: traces to X-Ray, metrics to CloudWatch.
  otel_sidecar = {
    name      = "otel"
    image     = "public.ecr.aws/aws-observability/aws-otel-collector:v0.41.1"
    essential = false
    command   = ["--config=/etc/ecs/ecs-default-config.yaml"]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.service["otel"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "otel"
      }
    }
  }

  services = {
    api = {
      image   = local.api_image
      command = ["node", "dist/main.js"]
      port    = 4000
      cpu     = var.api_cpu
      memory  = var.api_memory
      env     = local.app_environment
      secrets = local.task_secrets
      tg      = aws_lb_target_group.api.arn
    }
    realtime = {
      image   = local.api_image
      command = ["node", "dist/realtime.js"]
      port    = 4001
      cpu     = 1024
      memory  = 2048
      env     = local.app_environment
      secrets = local.task_secrets
      tg      = aws_lb_target_group.realtime.arn
    }
    worker = {
      image   = local.api_image
      command = ["node", "dist/worker.js"]
      port    = null
      # Two vCPUs for re-encoding video stories (D-164); a 15 s clip takes a few seconds.
      cpu     = 2048
      memory  = 4096
      env     = local.app_environment
      secrets = local.task_secrets
      tg      = null
    }
    web = {
      image   = local.web_image
      command = ["node_modules/.bin/next", "start", "--port", "3000"]
      port    = 3000
      cpu     = 1024
      memory  = 2048
      env = [
        { name = "NODE_ENV", value = "production" },
        { name = "API_URL", value = "https://${local.api}" },
        { name = "MEDIA_PUBLIC_BASE_URL", value = "https://${local.media}" },
        { name = "SUPPORT_EMAIL", value = var.support_email },
        { name = "LEGAL_ENTITY_NAME", value = var.legal_entity_name },
        { name = "LEGAL_ADDRESS", value = var.legal_address },
        { name = "GRIEVANCE_OFFICER_NAME", value = var.grievance_officer_name },
        { name = "GRIEVANCE_OFFICER_EMAIL", value = var.grievance_officer_email },
        { name = "APPLE_TEAM_ID", value = var.apple_team_id },
        { name = "ANDROID_SHA256_CERT_FINGERPRINTS", value = join(",", var.android_sha256_cert_fingerprints) },
      ]
      secrets = []
      tg      = aws_lb_target_group.web.arn
    }
  }
}

resource "aws_ecs_task_definition" "service" {
  for_each                 = local.services
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode(concat([{
    name                   = each.key
    image                  = each.value.image
    command                = each.value.command
    essential              = true
    readonlyRootFilesystem = false
    environment            = each.value.env
    secrets                = each.value.secrets
    portMappings           = each.value.port == null ? [] : [{ containerPort = each.value.port, protocol = "tcp" }]
    stopTimeout            = 30
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.service[each.key].name
        awslogs-region        = var.region
        awslogs-stream-prefix = each.key
      }
    }
  }], each.key == "web" ? [] : [local.otel_sidecar]))
}

# Migrations run as a one-off task before each deploy (LAUNCH_CHECKLIST.md / deploy steps):
#   aws ecs run-task --cluster <cluster> --task-definition <migrate> --launch-type FARGATE --network-configuration ...
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name        = "migrate"
    image       = local.api_image
    command     = ["node", "dist/infra/database/migrate.cli.js"]
    essential   = true
    environment = local.app_environment
    secrets     = local.task_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.service["migrate"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "migrate"
      }
    }
  }])
}

locals {
  scaling = {
    api      = { min = var.api_min_count, max = var.api_max_count }
    realtime = { min = var.realtime_min_count, max = var.realtime_max_count }
    worker   = { min = var.worker_count, max = var.worker_count }
    web      = { min = var.web_min_count, max = var.web_max_count }
  }
}

resource "aws_ecs_service" "service" {
  for_each                           = local.services
  name                               = each.key
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.service[each.key].arn
  desired_count                      = local.scaling[each.key].min
  launch_type                        = "FARGATE"
  enable_execute_command             = false
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = each.value.tg == null ? null : 60
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  dynamic "load_balancer" {
    for_each = each.value.tg == null ? [] : [each.value.tg]
    content {
      target_group_arn = load_balancer.value
      container_name   = each.key
      container_port   = each.value.port
    }
  }
  lifecycle {
    ignore_changes = [desired_count]
  }
  depends_on = [aws_lb_listener.https]
}

resource "aws_appautoscaling_target" "service" {
  for_each           = { for k, v in local.scaling : k => v if v.max > v.min }
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.service[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = each.value.min
  max_capacity       = each.value.max
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each           = aws_appautoscaling_target.service
  name               = "${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = each.value.service_namespace
  resource_id        = each.value.resource_id
  scalable_dimension = each.value.scalable_dimension
  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 120
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
