// check-parse.mjs - 一次性解析一批 ESM 源码（只做语法检查，不执行）
// 由 check-vue.js 拉起一次，避免反复 spawn 进程。
import vm from 'node:vm';
import fs from 'node:fs';

const list = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const item of list) {
  try {
    new vm.SourceTextModule(item.code);
    console.log('OK\t' + item.name);
  } catch (e) {
    console.log('ERR\t' + item.name + '\t' + (e && e.message ? e.message : String(e)));
  }
}
