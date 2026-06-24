variable "aws_region" {
  description = "AWS region for all resources. Align this with the Vercel function region (vercel.json)."
  type        = string
}

variable "project" {
  description = "Name prefix applied to resources and tags."
  type        = string
  default     = "riplo-arena"
}

variable "db_name" {
  description = "Initial database name."
  type        = string
  default     = "arena"
}

variable "db_username" {
  description = "Master username."
  type        = string
  default     = "arena"
}

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro is free-tier eligible and fine for a test."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage in GB."
  type        = number
  default     = 20
}

variable "db_engine_version" {
  description = "PostgreSQL major version."
  type        = string
  default     = "16"
}

variable "db_allowed_cidr" {
  description = "CIDR allowed to reach Postgres on 5432. Default is open (test only) — tighten before production. Vercel functions use dynamic egress IPs, so locking to Vercel specifically needs RDS Proxy + a static-IP setup (deferred)."
  type        = string
  default     = "0.0.0.0/0"
}
