locals {
  managed_rule_groups = ["AWSManagedRulesCommonRuleSet", "AWSManagedRulesKnownBadInputsRuleSet", "AWSManagedRulesAmazonIpReputationList", "AWSManagedRulesSQLiRuleSet"]
}

# Regional WAF in front of the ALB: AWS managed rules + per-IP rate limits (app-level limits still apply per user).
resource "aws_wafv2_web_acl" "alb" {
  name  = "${local.name}-alb"
  scope = "REGIONAL"
  default_action {
    allow {}
  }
  dynamic "rule" {
    for_each = { for i, name in local.managed_rule_groups : name => i }
    content {
      name     = rule.key
      priority = rule.value
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          name        = rule.key
          vendor_name = "AWS"
          # Uploads go straight to S3, so API bodies are small JSON; keep the body-size rule.
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.key
        sampled_requests_enabled   = true
      }
    }
  }
  # Mobile carriers in India put many people behind one CGNAT address, so the IP limit is generous;
  # sign-in has its own, much stricter limit.
  rule {
    name     = "ip-rate"
    priority = 10
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 6000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ip-rate"
      sampled_requests_enabled   = true
    }
  }
  rule {
    name     = "otp-rate"
    priority = 11
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 300
        aggregate_key_type = "IP"
        scope_down_statement {
          byte_match_statement {
            search_string         = "/v1/auth/otp"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "otp-rate"
      sampled_requests_enabled   = true
    }
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-alb"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.alb.arn
}

# CloudFront (media) WAF must be created in us-east-1.
resource "aws_wafv2_web_acl" "cloudfront" {
  provider = aws.us_east_1
  name     = "${local.name}-media"
  scope    = "CLOUDFRONT"
  default_action {
    allow {}
  }
  rule {
    name     = "AWSManagedRulesAmazonIpReputationList"
    priority = 0
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ip-reputation"
      sampled_requests_enabled   = true
    }
  }
  rule {
    name     = "ip-rate"
    priority = 1
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 20000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "media-ip-rate"
      sampled_requests_enabled   = true
    }
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-media"
    sampled_requests_enabled   = true
  }
}
