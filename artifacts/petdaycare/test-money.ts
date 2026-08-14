import { formatCentsToBRL } from './src/lib/money';

const tests = [
  0,
  1,
  99,
  100,
  1999,
  9999,
  10000,
  15000,
  123456,
  -100
];

tests.forEach(t => {
  console.log(`${t} -> ${formatCentsToBRL(t)}`);
});
