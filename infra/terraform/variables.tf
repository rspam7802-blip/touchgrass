variable "region" {
  description = "Primary region (Mumbai)."
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Deployment name, e.g. production or staging."
  type        = string
}

variable "support_email" {
  description = "Support address shown on /delete-account for people who can't open the app (store requirement), e.g. support@touchgrass.app."
  type        = string
}

variable "legal_entity_name" {
  description = "Registered company name shown on /privacy, /terms, /refunds and /contact."
  type        = string
}

variable "legal_address" {
  description = "Registered office address shown on /contact (Razorpay and the stores require one)."
  type        = string
}

variable "grievance_officer_name" {
  description = "Grievance Officer's name, published on /contact (IT Rules 2021, DPDP Act 2023)."
  type        = string
}

variable "grievance_officer_email" {
  description = "Grievance Officer's email, published on /contact and in the privacy policy."
  type        = string
}

variable "apple_team_id" {
  description = "Apple Developer Team ID (developer.apple.com → Membership) for iOS universal links. Empty = no app associated."
  type        = string
  default     = ""
}

variable "android_sha256_cert_fingerprints" {
  description = "SHA-256 fingerprints of the Play app signing key (Play Console → App integrity) for Android App Links."
  type        = list(string)
  default     = []
}

variable "seller_legal_name" {
  description = "Registered business name printed on receipts."
  type        = string
}

variable "seller_gstin" {
  description = "GSTIN printed on receipts (empty until GST registration is done)."
  type        = string
  default     = ""
}

variable "domain" {
  description = "Apex domain served by the web app (share pages, admin), e.g. touchgrass.app."
  type        = string
}

variable "api_subdomain" {
  description = "API and realtime host under the domain."
  type        = string
  default     = "api"
}

variable "media_subdomain" {
  description = "CloudFront host for user media."
  type        = string
  default     = "media"
}

variable "route53_zone_id" {
  description = "Hosted zone for the domain (records and certificate validation are created in it)."
  type        = string
}

variable "image_tag" {
  description = "Container image tag deployed for api, realtime, worker, migrate and web (e.g. the git SHA)."
  type        = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "db_instance_class" {
  description = "RDS writer and replica class (see docs/PERFORMANCE.md for sizing)."
  type        = string
  default     = "db.r6g.xlarge"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 200
}

variable "redis_node_type" {
  type    = string
  default = "cache.r7g.large"
}

variable "api_cpu" {
  description = "Fargate vCPU units per API task (1024 = 1 vCPU)."
  type        = number
  default     = 2048
}

variable "api_memory" {
  type    = number
  default = 4096
}

variable "api_min_count" {
  type    = number
  default = 3
}

variable "api_max_count" {
  type    = number
  default = 12
}

variable "realtime_min_count" {
  type    = number
  default = 2
}

variable "realtime_max_count" {
  type    = number
  default = 8
}

variable "worker_count" {
  type    = number
  default = 2
}

variable "web_min_count" {
  type    = number
  default = 2
}

variable "web_max_count" {
  type    = number
  default = 6
}

variable "alarm_email" {
  description = "Where CloudWatch alarms are sent (confirm the SNS subscription email)."
  type        = string
}

variable "admin_allowed_cidrs" {
  description = "Networks allowed to open /admin (office VPN egress). Empty list = admin open to all (not recommended)."
  type        = list(string)
  default     = []
}

variable "min_supported_app_version" {
  type    = string
  default = "1.0.0"
}

variable "latest_app_version" {
  type    = string
  default = "1.0.0"
}

variable "firebase_project_id" {
  description = "Firebase project ID for admin console sign-in (D-167). Empty = the console uses the API's own codes."
  type        = string
  default     = ""
}

variable "firebase_web_api_key" {
  description = "Public API key of the Firebase Web app (Project settings → Your apps), for admin console sign-in (D-167)."
  type        = string
  default     = ""
}
