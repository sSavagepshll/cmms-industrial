// Uso: npm run hash-pin -- 1234   -> imprime o valor para usuarios.pin_hash (nunca grave o PIN em texto puro)
import { hashPin } from '../src/auth/password.js';

const pin = process.argv[2];
if (!pin || !/^\d{4,6}$/.test(pin)) {
  console.error('Informe um PIN numérico de 4 a 6 dígitos.');
  process.exit(1);
}
console.log(await hashPin(pin));
