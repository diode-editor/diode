variable "cidr" {
  type    = string
  default = "10.0.0.0/16"
}

resource "aws_vpc" "shared" {
  cidr_block = var.cidr
}

module "net" {
  source = "./modules/net"
}
