'use strict';
const path=require('node:path'),assert=require('node:assert/strict');
const kit=process.env.PET_KIT_DIR;assert(kit&&path.isAbsolute(kit),'PET_KIT_DIR must point to reviewed pet-kit checkout');
console.log(require(path.join(kit,'scripts/vendor.cjs')).vendor(path.resolve(__dirname,'..')));
