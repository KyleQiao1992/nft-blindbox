import { network } from "hardhat";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

/**
 * 手动部署 UUPS 代理（因为 hre.upgrades 在 Hardhat 3 中不可用）
 */
async function deployUUPSProxy(
  ContractFactory: any,
  initArgs: any[],
  signer: any,
  ethers: any
) {
  // 1. 部署实现合约
  const implementation = await ContractFactory.connect(signer).deploy();
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();

  // 2. 获取初始化数据
  const initData = ContractFactory.interface.encodeFunctionData("initialize", initArgs);

  // 3. 从 OpenZeppelin 的 artifact 读取 ERC1967Proxy
  const ERC1967ProxyArtifact = require("@openzeppelin/contracts/build/contracts/ERC1967Proxy.json");
  const ERC1967ProxyFactory = new ethers.ContractFactory(
    ERC1967ProxyArtifact.abi,
    ERC1967ProxyArtifact.bytecode,
    signer
  );
  
  // 4. 部署代理
  const proxy = await ERC1967ProxyFactory.deploy(implementationAddress, initData);
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();

  // 5. 返回代理合约实例和实现地址
  return {
    proxy: await ethers.getContractAt(ContractFactory.interface, proxyAddress),
    implementationAddress,
  };
}

/**
 * 使用UUPS代理模式部署NFT盲盒合约
 * 
 * 使用方法：
 * npx hardhat run scripts/deployWithUUPS.ts --network sepolia
 */
async function main() {
  const connection = await network.connect();
  // @ts-ignore - ethers 属性由 @nomicfoundation/hardhat-ethers 插件添加
  const { ethers } = connection;
  const [deployer] = await ethers.getSigners();
  const parseBool = (value: string | undefined): boolean | undefined => {
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  };

  console.log("Deploying NFTBlindBox with UUPS Proxy...");
  console.log("Deployer:", deployer.address);

  // 从环境变量读取配置
  const name = process.env.NFT_NAME || "Mystery NFT";
  const symbol = process.env.NFT_SYMBOL || "MNFT";
  const maxSupply = BigInt(process.env.NFT_MAX_SUPPLY || "10000");
  const baseURI = process.env.NFT_BASE_URI || "ipfs://QmYourBaseURI/";

  // 模块地址（需要先部署模块）
  const saleManagerAddress = process.env.SALE_MANAGER_ADDRESS || "";
  const vrfHandlerAddress = process.env.VRF_HANDLER_ADDRESS || "";

  if (!saleManagerAddress || !vrfHandlerAddress) {
    throw new Error(
      "Please deploy modules first using deployModules.ts and set SALE_MANAGER_ADDRESS and VRF_HANDLER_ADDRESS in .env"
    );
  }
  if (!ethers.isAddress(saleManagerAddress) || !ethers.isAddress(vrfHandlerAddress)) {
    throw new Error("Invalid SALE_MANAGER_ADDRESS or VRF_HANDLER_ADDRESS");
  }

  console.log("\n=== Configuration ===");
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Max Supply:", maxSupply.toString());
  console.log("SaleManager:", saleManagerAddress);
  console.log("VRFHandler:", vrfHandlerAddress);
  console.log("Base URI:", baseURI);

  // 获取合约工厂
  const NFTBlindBoxUpgradeable = await ethers.getContractFactory(
    "NFTBlindBoxUpgradeable"
  );

  // 使用手动 UUPS 代理部署
  // 注意：根据合约代码，initialize需要price参数，虽然实际不使用
  // 这里传入0作为占位符，因为价格由SaleManager管理
  const { proxy, implementationAddress } = await deployUUPSProxy(
    NFTBlindBoxUpgradeable,
    [
      name,
      symbol,
      maxSupply,
      0n, // price参数（占位符，实际由SaleManager管理）
      saleManagerAddress,
      vrfHandlerAddress,
      baseURI,
    ],
    deployer,
    ethers
  );

  const proxyAddress = await proxy.getAddress();

  console.log("\n=== Deployment Info ===");
  console.log("Proxy Address:", proxyAddress);
  console.log("Implementation Address:", implementationAddress);

  // 验证部署
  const blindBox = await ethers.getContractAt(
    "NFTBlindBoxUpgradeable",
    proxyAddress
  );

  const deployedName = await blindBox.name();
  const deployedSymbol = await blindBox.symbol();
  const deployedMaxSupply = await blindBox.maxSupply();

  console.log("\n=== Verification ===");
  console.log("Name:", deployedName);
  console.log("Symbol:", deployedSymbol);
  console.log("Max Supply:", deployedMaxSupply.toString());

  // 验证模块连接
  const saleManager = await blindBox.saleManager();
  const vrfHandler = await blindBox.vrfHandler();
  console.log("Connected SaleManager:", saleManager);
  console.log("Connected VRFHandler:", vrfHandler);

  const shouldTransferModuleOwnership =
    parseBool(process.env.TRANSFER_MODULE_OWNERSHIP) ?? true;

  if (shouldTransferModuleOwnership) {
    console.log("\n=== Transfer Module Ownership ===");
    const saleManagerContract = await ethers.getContractAt(
      "SaleManager",
      saleManagerAddress
    );
    const vrfHandlerContract = await ethers.getContractAt(
      "VRFHandler",
      vrfHandlerAddress
    );

    const deployerLower = deployer.address.toLowerCase();
    const proxyLower = proxyAddress.toLowerCase();

    const saleOwner = (await saleManagerContract.owner()).toLowerCase();
    if (saleOwner === proxyLower) {
      console.log("SaleManager owner already set to NFT proxy");
    } else if (saleOwner !== deployerLower) {
      throw new Error(
        `SaleManager owner is ${saleOwner}, not deployer ${deployerLower}; cannot transfer ownership`
      );
    } else {
      const tx = await saleManagerContract.transferOwnership(proxyAddress);
      await tx.wait();
      console.log("SaleManager owner ->", proxyAddress);
    }

    const vrfOwner = (await vrfHandlerContract.owner()).toLowerCase();
    if (vrfOwner === proxyLower) {
      console.log("VRFHandler owner already set to NFT proxy");
    } else if (vrfOwner !== deployerLower) {
      throw new Error(
        `VRFHandler owner is ${vrfOwner}, not deployer ${deployerLower}; cannot transfer ownership`
      );
    } else {
      const tx = await vrfHandlerContract.transferOwnership(proxyAddress);
      await tx.wait();
      console.log("VRFHandler owner ->", proxyAddress);
    }
  } else {
    console.log("\nSkip module ownership transfer (TRANSFER_MODULE_OWNERSHIP=false)");
  }

  return {
    proxy: proxyAddress,
    implementation: implementationAddress,
  };
}

main()
  .then((result) => {
    console.log("\nDeployment successful!");
    console.log("Proxy:", result.proxy);
    console.log("\n💡 Next steps:");
    console.log("1. Add VRFHandler address as consumer in Chainlink Subscription");
    console.log("2. Configure sale params through NFT proxy (setPrice/setSalePhase/etc.)");
    console.log("3. Do one purchaseBox() test on Sepolia");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n Deployment failed:");
    console.error(error);
    process.exit(1);
  });
