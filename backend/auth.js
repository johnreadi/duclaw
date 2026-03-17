const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'votre_secret_jwt_changez_le_en_production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

class AuthManager {
  // Middleware d'authentification
  static middleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Token invalide' });
    }
  }

  // Middleware pour vérifier le rôle admin
  static requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
    }
    next();
  }

  // Créer un utilisateur
  async createUser(username, email, password, role = 'user') {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const query = `
      INSERT INTO users (username, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, username, email, role, created_at
    `;
    
    const result = await pool.query(query, [username, email, hashedPassword, role]);
    return result.rows[0];
  }

  // Authentifier un utilisateur
  async login(username, password) {
    const query = 'SELECT * FROM users WHERE username = $1';
    const result = await pool.query(query, [username]);
    
    if (result.rows.length === 0) {
      throw new Error('Utilisateur non trouvé');
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      throw new Error('Mot de passe incorrect');
    }

    // Mettre à jour la dernière connexion
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Générer le token JWT
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username, 
        email: user.email, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    };
  }

  // Récupérer tous les utilisateurs
  async getAllUsers() {
    const query = `
      SELECT id, username, email, role, created_at, last_login 
      FROM users 
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  // Mettre à jour un utilisateur
  async updateUser(userId, updates) {
    const allowedUpdates = ['username', 'email', 'role'];
    const setClause = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedUpdates.includes(key)) {
        setClause.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setClause.length === 0) {
      throw new Error('Aucune mise à jour valide');
    }

    values.push(userId);
    const query = `
      UPDATE users 
      SET ${setClause.join(', ')} 
      WHERE id = $${paramIndex}
      RETURNING id, username, email, role
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  // Changer le mot de passe
  async changePassword(userId, currentPassword, newPassword) {
    const userQuery = 'SELECT password_hash FROM users WHERE id = $1';
    const userResult = await pool.query(userQuery, [userId]);
    
    if (userResult.rows.length === 0) {
      throw new Error('Utilisateur non trouvé');
    }

    const isValidPassword = await bcrypt.compare(
      currentPassword, 
      userResult.rows[0].password_hash
    );
    
    if (!isValidPassword) {
      throw new Error('Mot de passe actuel incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hashedPassword, userId]
    );

    return true;
  }

  // Supprimer un utilisateur
  async deleteUser(userId) {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    return true;
  }

  // Créer l'utilisateur admin par défaut si aucun utilisateur n'existe
  async createDefaultAdmin() {
    const result = await pool.query('SELECT COUNT(*) FROM users');
    
    if (parseInt(result.rows[0].count) === 0) {
      console.log('Création de l\'utilisateur admin par défaut...');
      await this.createUser(
        'admin',
        'admin@duclaw.local',
        'admin123',
        'admin'
      );
      console.log('Utilisateur admin créé (username: admin, password: admin123)');
    }
  }
}

module.exports = AuthManager;
