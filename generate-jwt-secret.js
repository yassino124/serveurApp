// generate-jwt-secret.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(process.cwd(), '.env');
const force = process.argv.includes('--force');

function genSecret() {
  return crypto.randomBytes(64).toString('hex');
}

let env = '';
if (fs.existsSync(envPath)) {
  env = fs.readFileSync(envPath, 'utf8');
} else {
  // Crée un .env vide si besoin
  fs.writeFileSync(envPath, '', { encoding: 'utf8' });
  env = '';
}

const jwtLineRegex = /^JWT_SECRET=.*$/m;
const hasJwtLine = jwtLineRegex.test(env);
const jwtValue = (env.match(/^JWT_SECRET=(.*)$/m) || [])[1] || '';

if (hasJwtLine && jwtValue && !force) {
  console.log('⚠️  JWT_SECRET existe déjà et n\'est pas vide. Aucun changement effectué.');
  console.log(`Valeur actuelle (troncée) : ${jwtValue.slice(0, 8)}...`);
  process.exit(0);
}

const newSecret = genSecret();

// Supprime ligne existante (vide ou non) puis ajoute la nouvelle
let newEnv = env.replace(jwtLineRegex, '').trim();
if (newEnv.length > 0) newEnv += '\n';
newEnv += `JWT_SECRET=${newSecret}\n`;

// Écrit le fichier
fs.writeFileSync(envPath, newEnv, { encoding: 'utf8' });

console.log('✅ JWT_SECRET généré et ajouté au fichier .env :\n');
console.log(newSecret);
console.log('\n🔒 Si tu l\'exécutes en production, conserve cette clé en sécurité.');
