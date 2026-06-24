output "db_endpoint" {
  description = "RDS endpoint host."
  value       = aws_db_instance.this.address
}

output "db_port" {
  value = aws_db_instance.this.port
}

output "db_name" {
  value = var.db_name
}

output "database_url_secret_name" {
  description = "Secrets Manager secret holding the full DATABASE_URL. Fetch it, then set it (plus DATABASE_SSL=true) in Vercel."
  value       = aws_secretsmanager_secret.database_url.name
}

output "database_url_secret_arn" {
  value = aws_secretsmanager_secret.database_url.arn
}
