import dotenv from 'dotenv';
dotenv.config({ path: require('path').resolve(__dirname, '../.env') });

console.log('Testing environment variable loading...');
console.log('=====================================');
console.log('MYSQL_HOST:', process.env.MYSQL_HOST || 'not set');
console.log('MYSQL_PORT:', process.env.MYSQL_PORT || 'not set');
console.log('MYSQL_DATABASE:', process.env.MYSQL_DATABASE || 'not set');
console.log('MYSQL_USER:', process.env.MYSQL_USER || 'not set');
console.log('MYSQL_PASSWORD:', process.env.MYSQL_PASSWORD ? '[SET]' : 'not set');
console.log('MONGO_URL:', process.env.MONGO_URL || 'not set');
console.log('TEST_MODE:', process.env.TEST_MODE || 'not set');
console.log('TEST_LIMIT:', process.env.TEST_LIMIT || 'not set');
console.log('=====================================');
console.log('Environment file path:', require('path').resolve(__dirname, '../.env'));
console.log('File exists:', require('fs').existsSync(require('path').resolve(__dirname, '../.env')));
