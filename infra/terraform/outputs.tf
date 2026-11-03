output "web_url" {
  value = "https://${var.domain}"
}

output "api_url" {
  value = "https://${local.api}"
}

output "media_url" {
  value = "https://${local.media}"
}

output "ecr_repositories" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task_definition" {
  value = aws_ecs_task_definition.migrate.arn
}

output "private_subnets" {
  value = aws_subnet.private[*].id
}

output "task_security_group" {
  value = aws_security_group.tasks.id
}

output "provider_secret_name" {
  description = "Fill in third-party keys here after the first apply (LAUNCH_CHECKLIST.md)."
  value       = aws_secretsmanager_secret.providers.name
}
