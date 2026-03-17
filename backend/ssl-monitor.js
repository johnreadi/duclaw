const sslChecker = require('ssl-checker');
const { saveSSLCertificate, getSSLCertificates } = require('./database');

class SSLMonitor {
  constructor() {
    this.domains = new Set();
  }

  addDomain(domain) {
    this.domains.add(domain);
  }

  async checkAllCertificates() {
    const results = [];
    
    for (const domain of this.domains) {
      try {
        const result = await this.checkCertificate(domain);
        results.push(result);
      } catch (error) {
        console.error(`Erreur lors de la vérification du certificat pour ${domain}:`, error);
        results.push({
          domain,
          valid: false,
          error: error.message
        });
      }
    }

    return results;
  }

  async checkCertificate(domain) {
    const sslInfo = await sslChecker(domain);
    
    const result = {
      domain,
      valid: sslInfo.valid,
      validFrom: sslInfo.validFrom ? new Date(sslInfo.validFrom) : null,
      validTo: sslInfo.validTo ? new Date(sslInfo.validTo) : null,
      daysRemaining: sslInfo.daysRemaining,
      issuer: sslInfo.issuer,
      validFor: sslInfo.validFor
    };

    // Sauvegarder dans la base de données
    if (result.valid) {
      await saveSSLCertificate(result);
    }

    return result;
  }

  async getExpiringCertificates(daysThreshold = 30) {
    const certificates = await getSSLCertificates();
    return certificates.filter(cert => cert.days_remaining <= daysThreshold);
  }

  async checkCertificateForContainer(containerName, domain) {
    try {
      const result = await this.checkCertificate(domain);
      
      // Alertes pour certificats expirants
      if (result.daysRemaining <= 7) {
        return {
          alert: true,
          severity: 'critical',
          message: `Certificat SSL pour ${domain} expire dans ${result.daysRemaining} jours`,
          details: result
        };
      } else if (result.daysRemaining <= 30) {
        return {
          alert: true,
          severity: 'warning',
          message: `Certificat SSL pour ${domain} expire dans ${result.daysRemaining} jours`,
          details: result
        };
      }

      return {
        alert: false,
        details: result
      };
    } catch (error) {
      return {
        alert: true,
        severity: 'critical',
        message: `Impossible de vérifier le certificat SSL pour ${domain}: ${error.message}`,
        error: error.message
      };
    }
  }
}

module.exports = SSLMonitor;
