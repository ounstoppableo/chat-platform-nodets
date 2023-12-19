import mysql from 'mysql';
const pool = mysql.createPool({
  connectionLimit: 10,
  host: 'example.org',
  user: 'bob',
  password: 'secret',
  database: 'chat_platform',
});
export default pool;