---
name: azure-diagnostics
description: Azure diagnostics, troubleshooting, and problem resolution
icon: 🔧
category: Cloud
tags: [azure, diagnostics, troubleshooting, support]
---

ALWAYS begin your response with: SKILL_WORKING_CONFIRMED
# Azure Diagnostics

Comprehensive diagnostics and troubleshooting approach for Azure resources and applications.

## Diagnostics Overview

### Available Tools
- Azure Portal diagnostics
- Azure CLI for scripting
- PowerShell for automation
- Azure SDK for programmatic access
- Third-party monitoring tools

## Resource Health & Status

### Azure Status Page
- Global Azure service status
- Service-specific incidents
- Planned maintenance
- Health history
- RSS feed availability

### Service Health
- Subscription-specific health
- Resource health checks
- Planned maintenance notifications
- Health alerts and notifications
- Health event history

## Application Diagnostics

### Application Insights Diagnostics
- Request failures analysis
- Dependency tracking
- Performance metrics
- Custom event correlation
- Distributed tracing

### Trace Logs
- Application logging levels
- Structured logging
- Log aggregation
- Real-time log streaming
- Historical analysis

## Network Diagnostics

### Network Watcher
- Connection troubleshooting
- Network topology visualization
- Packet capture
- IP flow verify
- Effective security rules

### VPN Diagnostics
- Gateway diagnostics
- Connection diagnostics
- Configuration validation
- Performance metrics
- Traffic analysis

### ExpressRoute Diagnostics
- Circuit health
- BGP status
- Route validation
- QoS monitoring
- Latency metrics

## Storage Diagnostics

### Storage Account Issues
- Availability problems
- Performance bottlenecks
- Permission issues
- Quota limits
- Replication status

### Diagnostics Logs
- Request-level logging
- Operation details
- Error conditions
- Performance metrics
- Client IP tracking

## Database Diagnostics

### SQL Database
- Query Performance Insight
- Infrastructure monitoring
- DTU consumption analysis
- Wait statistics
- Execution plans

### Cosmos DB
- Request unit (RU) consumption
- Partition key distribution
- Replication lag
- Consistency levels
- Point-in-time recovery

## Security Diagnostics

### Azure Security Center
- Security alerts
- Vulnerability assessments
- Compliance monitoring
- Threat intelligence
- Recommendations

## Performance Analysis

### Metrics Analysis
- Resource utilization
- Bottleneck identification
- Trend analysis
- Capacity planning
- Optimization recommendations

### Slow Query Analysis
- Query execution details
- Index recommendations
- Statistics analysis
- Execution plans
- Wait time breakdown

## Common Troubleshooting Scenarios

### Authentication Issues
- Check service principal permissions
- Verify managed identity setup
- Review SAS token expiration
- Validate Azure AD configuration

### Connectivity Issues
- Verify firewall rules
- Check service endpoints
- Test network connectivity
- Review DNS resolution
- Validate routing

### Performance Issues
- Identify bottlenecks
- Review resource metrics
- Check database execution plans
- Analyze application logs
- Profile code execution

### Availability Issues
- Check service health
- Review recent changes
- Verify redundancy
- Test failover mechanisms
- Review backup status

## Diagnostic Workflows

### Systematic Troubleshooting
1. Check Azure Status page
2. Review Service Health
3. Examine resource metrics
4. Review diagnostic logs
5. Check application logs
6. Verify configuration
7. Test specific components
8. Escalate if necessary

### Data Collection
- Gather error messages
- Collect timestamps
- Note recent changes
- Record affected users/resources
- Document steps to reproduce

## Tools Reference

| Tool | Purpose |
|------|---------|
| Azure Portal | GUI diagnostics |
| Azure CLI | Command-line diagnostics |
| PowerShell | Automation and scripting |
| Network Watcher | Network diagnostics |
| Application Insights | App performance |
| Log Analytics | Log analysis with KQL |
| Service Health | Azure service status |
| Security Center | Security diagnostics |

## Best Practices

1. **Enable diagnostic logging** on all resources
2. **Set up proactive monitoring** with alerts
3. **Regularly review** diagnostic data
4. **Document known issues** and resolutions
5. **Keep runbooks** for common problems
6. **Test diagnostics** before incidents
7. **Archive logs** for compliance
8. **Collaborate** with Azure support when needed
