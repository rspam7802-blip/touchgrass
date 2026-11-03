# Generated secrets: created here, never printed, injected into tasks as ECS secrets.
resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "pepper" {
  length  = 64
  special = false
}

resource "random_password" "signed_url" {
  length  = 64
  special = false
}

resource "random_password" "db" {
  length  = 40
  special = false
}

resource "random_password" "redis" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name       = "${local.name}/app"
  kms_key_id = aws_kms_key.main.arn
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    JWT_ACCESS_SECRET    = random_password.jwt.result
    TOKEN_HASH_PEPPER    = random_password.pepper.result
    SIGNED_URL_SECRET    = random_password.signed_url.result
    DATABASE_URL         = "postgres://touchgrass:${random_password.db.result}@${aws_db_instance.main.address}:5432/touchgrass?sslmode=verify-full"
    DATABASE_REPLICA_URL = "postgres://touchgrass:${random_password.db.result}@${aws_db_instance.replica.address}:5432/touchgrass?sslmode=verify-full"
    REDIS_URL            = "rediss://:${random_password.redis.result}@${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
  })
}

# Third-party keys are entered by a person after the first apply (LAUNCH_CHECKLIST.md); Terraform creates the
# empty secret and never overwrites what was put in it.
resource "aws_secretsmanager_secret" "providers" {
  name       = "${local.name}/providers"
  kms_key_id = aws_kms_key.main.arn
}

resource "aws_secretsmanager_secret_version" "providers" {
  secret_id = aws_secretsmanager_secret.providers.id
  secret_string = jsonencode({
    MSG91_AUTH_KEY          = ""
    MSG91_OTP_TEMPLATE_ID   = ""
    MSG91_SMS_FLOW_ID       = ""
    RAZORPAY_KEY_ID         = ""
    RAZORPAY_KEY_SECRET     = ""
    RAZORPAY_WEBHOOK_SECRET = ""
    EXPO_ACCESS_TOKEN       = ""
    GOOGLE_MAPS_API_KEY     = ""
    OPENWEATHER_API_KEY     = ""
    POSTHOG_API_KEY         = ""
    SENTRY_DSN              = ""
    STORE_REVIEW_PHONE      = ""
    STORE_REVIEW_OTP        = ""
  })
  lifecycle {
    ignore_changes = [secret_string]
  }
}

locals {
  app_secret_keys = [
    "JWT_ACCESS_SECRET", "TOKEN_HASH_PEPPER", "SIGNED_URL_SECRET", "DATABASE_URL", "DATABASE_REPLICA_URL", "REDIS_URL",
  ]
  provider_secret_keys = [
    "MSG91_AUTH_KEY", "MSG91_OTP_TEMPLATE_ID", "MSG91_SMS_FLOW_ID", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET", "EXPO_ACCESS_TOKEN", "GOOGLE_MAPS_API_KEY", "OPENWEATHER_API_KEY", "POSTHOG_API_KEY",
    "SENTRY_DSN", "STORE_REVIEW_PHONE", "STORE_REVIEW_OTP",
  ]
  task_secrets = concat(
    [for k in local.app_secret_keys : { name = k, valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::" }],
    [for k in local.provider_secret_keys : { name = k, valueFrom = "${aws_secretsmanager_secret.providers.arn}:${k}::" }],
  )
}
