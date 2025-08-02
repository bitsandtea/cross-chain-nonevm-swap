import hre from "hardhat";

export const verifyContract = async (
  address: string,
  constructorArguments: any[],
  waitInSeconds = 60
) => {
  if (hre.network.name !== "hardhat" && hre.network.name !== "ganache") {
    //if its local don't verify Contract
    await waitSeconds(waitInSeconds);
    await hre.run("verify:verify", {
      address: address,
      constructorArguments: constructorArguments,
    });
  } else {
    console.log("Skipping verification for local network");
  }

  function waitSeconds(seconds: number) {
    const secs = seconds * 1000;
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, secs);
    });
  }
};
