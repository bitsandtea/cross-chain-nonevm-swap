import { ethers } from "hardhat";

async function main() {
  const mnemonic =
    "test test test test test test test test test test test junk";

  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic);

  for (let i = 0; i < 20; i++) {
    const path = `m/44'/60'/0'/0/${i}`;
    const pathWithoutM = path.replace("m/", "");
    const account = hdNode.derivePath(pathWithoutM);
    console.log(`Account ${i}    : ${account.address}`);
    console.log(`Private Key ${i}: ${account.privateKey}`);
  }
}

main().catch(console.error);
