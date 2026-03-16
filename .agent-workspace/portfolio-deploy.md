# Azure Portfolio Deployment

Deploy a static portfolio website on Azure using the most powerful VM available.

## VM Specifications

- **Series**: Dv5-series (Latest generation, compute-optimized)
- **vCPUs**: Up to 96 vCPUs
- **Memory**: Up to 384 GiB RAM
- **Best For**: Static website hosting, web servers, compute-intensive workloads

## Quick Deployment

### Option 1: Azure CLI (Recommended)

```bash
# Make script executable
chmod +x deploy-azure.sh

# Run deployment
./deploy-azure.sh
```

### Option 2: ARM Template

```bash
az group create --name portfolio-rg --location eastus

az deployment group create \
  --resource-group portfolio-rg \
  --template-uri https://raw.githubusercontent.com/your-repo/azure-deploy.json \
  --parameters adminUsername=azureuser dnsLabelPrefix=portfolio
```

## After Deployment

1. Get the VM IP:
   ```bash
   az vm show --resource-group portfolio-rg --name portfolio-vm --query '[publicIps]' --output tsv
   ```

2. Access your website: `http://<VM-IP>`

3. SSH into VM: `ssh azureuser@<VM-IP>`

## Files

- `portfolio/index.html` - Static website
- `deploy-azure.sh` - Deployment script
- `azure-deploy.json` - ARM template

## Cleanup

```bash
az group delete --name portfolio-rg --yes
```