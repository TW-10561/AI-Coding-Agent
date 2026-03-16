#!/bin/bash
# Azure Portfolio Deployment Script
# Deploys a static website on the most powerful Azure VM (Dv5-series)

set -e

# Configuration
RESOURCE_GROUP="portfolio-rg"
LOCATION="eastus"
VM_NAME="portfolio-vm"
VM_SIZE="Standard_Dv5-series"  # Most powerful compute-optimized VM
ADMIN_USERNAME="azureuser"
SCRIPT_DIR="$(dirname "$0")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo_step() {
    echo -e "${GREEN}==>${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}!${NC} $1"
}

# Check Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "Error: Azure CLI not found. Install from https://docs.microsoft.com/azure-cli"
    exit 1
fi

echo "========================================"
echo "Azure Portfolio Deployment"
echo "VM Size: $VM_SIZE (Most Powerful)"
echo "========================================"
echo ""

# Step 1: Create Resource Group
echo_step "Creating Resource Group..."
az group create --name $RESOURCE_GROUP --location $LOCATION --output table

# Step 2: Create Virtual Network
echo_step "Creating Virtual Network..."
az network vnet create --resource-group $RESOURCE_GROUP --name portfolio-vnet --address-prefixes 10.0.0.0/16 --output table

# Step 3: Create Subnet
echo_step "Creating Subnet..."
az network vnet subnet create --resource-group $RESOURCE_GROUP --vnet-name portfolio-vnet --name portfolio-subnet --address-prefixes 10.0.1.0/24 --output table

# Step 4: Create Public IP
echo_step "Creating Public IP..."
az network public-ip create --resource-group $RESOURCE_GROUP --name portfolio-pip --allocation-method Dynamic --sku Basic --output table

# Step 5: Create Network Security Group with SSH and HTTP rules
echo_step "Creating Network Security Group..."
az network nsg create --resource-group $RESOURCE_GROUP --name portfolio-nsg --output table

# Allow SSH
echo_step "Allowing SSH (port 22)..."
az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name portfolio-nsg --name AllowSS --destination-port-range 22 --access Allow --protocol T --source-address-prefix * --priority 100 --output table

# Allow HTTP
echo_step "Allowing HTTP (port 80)..."
az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name portfolio-nsg --name AllowHTTP --destination-port-range 80 --access Allow --protocol T --source-address-prefix * --priority 101 --output table

# Allow HTTPS
echo_step "Allowing HTTPS (port 443)..."
az network nsg rule create --resource-group $RESOURCE_GROUP --nsg-name portfolio-nsg --name AllowHTTPS --destination-port-range 443 --access Allow --protocol T --source-address-prefix * --priority 102 --output table

# Step 6: Create Network Interface
echo_step "Creating Network Interface..."
az network nic create --resource-group $RESOURCE_GROUP --name portfolio-nic --vnet-name portfolio-vnet --subnet portfolio-subnet --public-ip portfolio-pip --network-security-group portfolio-nsg --output table

# Step 7: Create VM
echo_step "Creating VM ($VM_SIZE)..."
az vm create --resource-group $RESOURCE_GROUP --name $VM_NAME --image Ubuntu2204 --admin-username $ADMIN_USERNAME --size "$VM_SIZE" --nic portfolio-nic --generate-ssh-keys --output table

# Get VM IP
echo_step "Getting VM Public IP..."
VM_IP=$(az vm show --resource-group $RESOURCE_GROUP --name $VM_NAME --query '[publicIps]' --output tsv)
echo "VM Public IP: $VM_IP"

# Step 8: Deploy Static Website
echo_step "Deploying Static Website..."
az vm run-command invoke $VM_NAME --resource-group $RESOURCE_GROUP --command-id 'RunShellScript' --output table <<EOF
#!/bin/bash
set -e

# Update system
apt-get update -qq
apt-get install -y nginx git -qq

# Create web directory
mkdir -p /var/www/portfolio

# Deploy website (clone repo or use provided files)
cd /tmp
git clone https://github.com/your-username/portfolio.git portfolio-repo 2>/dev/null || echo "No repo, using local files"

# Copy files if available
if [ -d /tmp/portfolio-repo ]; then
    cp -r /tmp/portfolio-repo/* /var/www/portfolio/
else
    # Create simple index.html if no repo
cat > /var/www/portfolio/index.html <<'HTMLEOF'
<!DOCTYPE html>
<html><head><title>Portfolio</title></head>
<body><h1>My Portfolio</h1><p>Deployed on Azure Dv5-series VM</p></body></html>
HTMLEOF
fi

# Ensure proper permissions
chmod -R 755 /var/www/portfolio
chown -R www-data:www-data /var/www/portfolio

# Configure nginx
cat > /etc/nginx/sites-available/portfolio <<'NGEOF'
server {
    listen 80;
    server_name _;
    root /var/www/portfolio;
    index index.html;
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGEOF

ln -sf /etc/nginx/sites-available/portfolio /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t

# Restart nginx
systemctl restart nginx

echo "Website deployed successfully!"
EOF

echo ""
echo "========================================"
echo "Deployment Complete!"
echo "========================================"
echo ""
echo "VM IP: $VM_IP"
echo "Website URL: http://$VM_IP"
echo ""
echo "To connect: ssh $ADMIN_USERNAME@$VM_IP"
echo ""
echo "To check deployment: curl http://$VM_IP"