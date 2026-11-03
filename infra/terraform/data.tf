# ---------- PostgreSQL 16 + PostGIS: Multi-AZ writer and a read replica ----------
resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.data[*].id
}

resource "aws_db_parameter_group" "pg16" {
  name   = "${local.name}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
}

resource "aws_db_instance" "main" {
  identifier                            = local.name
  engine                                = "postgres"
  engine_version                        = "16.4"
  instance_class                        = var.db_instance_class
  allocated_storage                     = var.db_allocated_storage_gb
  max_allocated_storage                 = var.db_allocated_storage_gb * 4
  storage_type                          = "gp3"
  storage_encrypted                     = true
  kms_key_id                            = aws_kms_key.main.arn
  db_name                               = "touchgrass"
  username                              = "touchgrass"
  password                              = random_password.db.result
  multi_az                              = true
  db_subnet_group_name                  = aws_db_subnet_group.main.name
  vpc_security_group_ids                = [aws_security_group.db.id]
  parameter_group_name                  = aws_db_parameter_group.pg16.name
  backup_retention_period               = 14
  backup_window                         = "20:30-21:30" # 02:00–03:00 IST
  maintenance_window                    = "sun:21:30-sun:22:30"
  deletion_protection                   = true
  skip_final_snapshot                   = false
  final_snapshot_identifier             = "${local.name}-final"
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.main.arn
  performance_insights_retention_period = 7
  monitoring_interval                   = 60
  monitoring_role_arn                   = aws_iam_role.rds_monitoring.arn
  auto_minor_version_upgrade            = true
  copy_tags_to_snapshot                 = true
  enabled_cloudwatch_logs_exports       = ["postgresql"]
}

resource "aws_db_instance" "replica" {
  identifier                      = "${local.name}-replica"
  replicate_source_db             = aws_db_instance.main.identifier
  instance_class                  = var.db_instance_class
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.main.arn
  vpc_security_group_ids          = [aws_security_group.db.id]
  parameter_group_name            = aws_db_parameter_group.pg16.name
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.main.arn
  monitoring_interval             = 60
  monitoring_role_arn             = aws_iam_role.rds_monitoring.arn
  skip_final_snapshot             = true
  auto_minor_version_upgrade      = true
}

# ---------- Redis: cache, rate limits, locks, BullMQ queues, socket.io adapter ----------
resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.data[*].id
}

resource "aws_elasticache_parameter_group" "redis7" {
  name   = "${local.name}-redis7"
  family = "redis7"
  # BullMQ requires keys never be evicted.
  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = local.name
  description                = "TouchGrass cache, queues and realtime fan-out"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  parameter_group_name       = aws_elasticache_parameter_group.redis7.name
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.main.arn
  transit_encryption_enabled = true
  auth_token                 = random_password.redis.result
  snapshot_retention_limit   = 7
  snapshot_window            = "21:30-22:30"
  maintenance_window         = "sun:22:30-sun:23:30"
}
