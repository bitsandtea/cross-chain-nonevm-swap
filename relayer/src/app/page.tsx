"use client";

import { ethers } from "ethers";
import { useEffect, useState } from "react";

// TypeScript declarations for ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: {
        method: string;
        params?: unknown[];
      }) => Promise<unknown>;
      on: (eventName: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (
        eventName: string,
        handler: (...args: unknown[]) => void
      ) => void;
    };
  }
}

interface SwapOrder {
  id: string;
  maker: string;
  taker: string;
  tokenAddress: string;
  amount: string;
  hashlock: string;
  timelock: number;
  status: "pending" | "funded" | "completed" | "cancelled";
}

export default function Home() {
  const [account, setAccount] = useState<string>("");
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [orders, setOrders] = useState<SwapOrder[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // Form states
  const [tokenAddress, setTokenAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [takerAddress, setTakerAddress] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<SwapOrder | null>(null);
  const [secret, setSecret] = useState("");
  const [storedEscrows, setStoredEscrows] = useState<Record<string, unknown>[]>(
    []
  );
  const [storedEvents, setStoredEvents] = useState<Record<string, unknown>[]>(
    []
  );
  const [isLoadingData, setIsLoadingData] = useState(false);

  const escrowFactoryAddress =
    process.env.NEXT_PUBLIC_ESCROW_FACTORY_EVM ||
    "0x0000000000000000000000000000000000000000";

  useEffect(() => {
    connectWallet();
    loadStoredData();
  }, []);

  const loadStoredData = async () => {
    setIsLoadingData(true);
    try {
      // Load escrows
      const escrowsResponse = await fetch("/api/escrows");
      if (escrowsResponse.ok) {
        const escrowsData = await escrowsResponse.json();
        setStoredEscrows(escrowsData.data || []);
      }

      // Load events
      const eventsResponse = await fetch("/api/events");
      if (eventsResponse.ok) {
        const eventsData = await eventsResponse.json();
        setStoredEvents(eventsData.data || []);
      }
    } catch (error) {
      console.error("Error loading stored data:", error);
    } finally {
      setIsLoadingData(false);
    }
  };

  const connectWallet = async () => {
    if (typeof window.ethereum !== "undefined") {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();

        setProvider(provider);
        setSigner(signer);
        setAccount(address);

        // Listen for account changes
        window.ethereum.on("accountsChanged", (accounts: unknown) => {
          const accountArray = accounts as string[];
          setAccount(accountArray[0] || "");
        });
      } catch (error) {
        console.error("Failed to connect wallet:", error);
      }
    }
  };

  const createSwapOrder = async () => {
    if (!signer || !tokenAddress || !amount || !takerAddress) return;

    setIsCreating(true);
    try {
      // Generate random secret and hash
      const secretBytes = ethers.randomBytes(32);
      const secretHex = ethers.hexlify(secretBytes);
      const hashlock = ethers.keccak256(secretHex);

      // Calculate timelock (5 stages as per spec)
      const now = Math.floor(Date.now() / 1000);
      const timelock = now + 3600; // 1 hour for demo

      // Create EscrowFactory contract instance
      const factoryABI = [
        "function createEscrow(address token, uint256 amount, address taker, bytes32 hashlock, uint256 timelock) external returns (address escrow)",
        "event EscrowCreated(address indexed escrow, address indexed maker, address indexed taker, address token, uint256 amount, bytes32 hashlock, uint256 timelock)",
      ];

      const factory = new ethers.Contract(
        escrowFactoryAddress,
        factoryABI,
        signer
      );

      // Approve tokens first (assuming ERC20)
      const tokenABI = [
        "function approve(address spender, uint256 amount) external returns (bool)",
      ];
      const token = new ethers.Contract(tokenAddress, tokenABI, signer);
      await token.approve(escrowFactoryAddress, ethers.parseEther(amount));

      // Create escrow
      const tx = await factory.createEscrow(
        tokenAddress,
        ethers.parseEther(amount),
        takerAddress,
        hashlock,
        timelock
      );

      await tx.wait();

      // Add to local state
      const newOrder: SwapOrder = {
        id: hashlock,
        maker: account,
        taker: takerAddress,
        tokenAddress,
        amount,
        hashlock,
        timelock,
        status: "pending",
      };

      setOrders([...orders, newOrder]);

      // Store secret locally (in production, this should be encrypted)
      localStorage.setItem(`secret_${hashlock}`, secretHex);

      // Reset form
      setTokenAddress("");
      setAmount("");
      setTakerAddress("");
    } catch (error) {
      console.error("Failed to create swap order:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const acceptSwapOrder = async (order: SwapOrder) => {
    if (!signer) return;

    setIsAccepting(true);
    try {
      // For demo purposes, we'll simulate accepting the order
      // In real implementation, this would call the destination chain's factory

      const updatedOrder = { ...order, status: "funded" as const };
      setOrders(orders.map((o) => (o.id === order.id ? updatedOrder : o)));
    } catch (error) {
      console.error("Failed to accept swap order:", error);
    } finally {
      setIsAccepting(false);
    }
  };

  const withdrawFunds = async (order: SwapOrder) => {
    if (!signer || !secret) return;

    setIsWithdrawing(true);
    try {
      // Verify hashlock matches
      const hashlock = ethers.keccak256(secret);
      if (hashlock !== order.hashlock) {
        throw new Error("Invalid secret");
      }

      // Call escrow contract to withdraw
      const escrowABI = [
        "function withdraw(string calldata preimage) external",
        "event FundsClaimed(address indexed recipient, uint256 amount, string preimage)",
      ];

      // In real implementation, you'd get the escrow address from the factory
      // For demo, we'll simulate the withdrawal
      const updatedOrder = { ...order, status: "completed" as const };
      setOrders(orders.map((o) => (o.id === order.id ? updatedOrder : o)));

      setSecret("");
      setSelectedOrder(null);
    } catch (error) {
      console.error("Failed to withdraw funds:", error);
    } finally {
      setIsWithdrawing(false);
    }
  };

  const cancelOrder = async (order: SwapOrder) => {
    if (!signer) return;

    try {
      // Call escrow contract to cancel
      const escrowABI = ["function cancel() external"];

      // For demo, we'll simulate cancellation
      const updatedOrder = { ...order, status: "cancelled" as const };
      setOrders(orders.map((o) => (o.id === order.id ? updatedOrder : o)));
    } catch (error) {
      console.error("Failed to cancel order:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-center mb-8">
          Cross-Chain Swap dApp
        </h1>

        {/* CLI Note */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8 text-center">
          <p className="text-blue-800 text-sm">
            📡 Event Listener runs via CLI:{" "}
            <code className="bg-blue-100 px-2 py-1 rounded">pnpm listener</code>
          </p>
          <p className="text-blue-800 text-sm mt-2">
            💾 Data is stored in{" "}
            <code className="bg-blue-100 px-2 py-1 rounded">
              escrow-db.json
            </code>
          </p>
        </div>

        {/* Wallet Connection */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Wallet</h2>
          {!account ? (
            <button
              onClick={connectWallet}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              Connect Wallet
            </button>
          ) : (
            <p className="text-sm text-gray-600">
              Connected: {account.slice(0, 6)}...{account.slice(-4)}
            </p>
          )}
        </div>

        {/* Create Swap Order */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Create Swap Order</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <input
              type="text"
              placeholder="Token Address"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
              className="border rounded px-3 py-2"
            />
            <input
              type="number"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="border rounded px-3 py-2"
            />
            <input
              type="text"
              placeholder="Taker Address"
              value={takerAddress}
              onChange={(e) => setTakerAddress(e.target.value)}
              className="border rounded px-3 py-2"
            />
          </div>
          <button
            onClick={createSwapOrder}
            disabled={isCreating || !account}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
          >
            {isCreating ? "Creating..." : "Create Order"}
          </button>
        </div>

        {/* Swap Orders */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Swap Orders</h2>
          {orders.length === 0 ? (
            <p className="text-gray-500">No orders yet</p>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => (
                <div key={order.id} className="border rounded p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-medium">
                        Order: {order.id.slice(0, 8)}...
                      </p>
                      <p className="text-sm text-gray-600">
                        Maker: {order.maker.slice(0, 6)}...
                        {order.maker.slice(-4)}
                      </p>
                      <p className="text-sm text-gray-600">
                        Taker: {order.taker.slice(0, 6)}...
                        {order.taker.slice(-4)}
                      </p>
                      <p className="text-sm text-gray-600">
                        Amount: {order.amount} tokens
                      </p>
                    </div>
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        order.status === "pending"
                          ? "bg-yellow-100 text-yellow-800"
                          : order.status === "funded"
                          ? "bg-blue-100 text-blue-800"
                          : order.status === "completed"
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {order.status}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    {order.status === "pending" && order.taker === account && (
                      <button
                        onClick={() => acceptSwapOrder(order)}
                        disabled={isAccepting}
                        className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                      >
                        {isAccepting ? "Accepting..." : "Accept"}
                      </button>
                    )}

                    {order.status === "funded" && order.maker === account && (
                      <button
                        onClick={() => setSelectedOrder(order)}
                        className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                      >
                        Withdraw
                      </button>
                    )}

                    {order.status === "pending" && order.maker === account && (
                      <button
                        onClick={() => cancelOrder(order)}
                        className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Stored Escrow Data */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Stored Escrow Data</h2>
            <button
              onClick={loadStoredData}
              disabled={isLoadingData}
              className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoadingData ? "Loading..." : "Refresh"}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Escrows */}
            <div>
              <h3 className="text-lg font-medium mb-3">
                Escrows ({storedEscrows.length})
              </h3>
              {storedEscrows.length === 0 ? (
                <p className="text-gray-500 text-sm">No escrows stored yet</p>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {storedEscrows.map((escrow, index) => (
                    <div key={index} className="border rounded p-3 text-sm">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-medium">Escrow #{index + 1}</span>
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            String(escrow.status) === "pending"
                              ? "bg-yellow-100 text-yellow-800"
                              : String(escrow.status) === "funded"
                              ? "bg-blue-100 text-blue-800"
                              : String(escrow.status) === "withdrawn"
                              ? "bg-green-100 text-green-800"
                              : String(escrow.status) === "cancelled"
                              ? "bg-red-100 text-red-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {String(escrow.status || "")}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600">
                        Address: {String(escrow.escrowAddress || "")}
                      </p>
                      <p className="text-xs text-gray-600">
                        Hashlock: {String(escrow.hashlock || "").slice(0, 8)}...
                      </p>
                      <p className="text-xs text-gray-600">
                        Maker: {String(escrow.maker || "").slice(0, 6)}...
                      </p>
                      <p className="text-xs text-gray-600">
                        Taker: {String(escrow.taker || "").slice(0, 6)}...
                      </p>
                      <p className="text-xs text-gray-600">
                        Amount: {String(escrow.amount || "")}
                      </p>
                      <p className="text-xs text-gray-600">
                        Chain: {Number(escrow.chainId || 0)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Events */}
            <div>
              <h3 className="text-lg font-medium mb-3">
                Events ({storedEvents.length})
              </h3>
              {storedEvents.length === 0 ? (
                <p className="text-gray-500 text-sm">No events stored yet</p>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {storedEvents.map((event, index) => (
                    <div key={index} className="border rounded p-3 text-sm">
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-medium">Event #{index + 1}</span>
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            String(event.type) === "EscrowCreated"
                              ? "bg-green-100 text-green-800"
                              : String(event.type) === "FundsClaimed"
                              ? "bg-blue-100 text-blue-800"
                              : String(event.type) === "OrderCancelled"
                              ? "bg-red-100 text-red-800"
                              : String(event.type) === "FundsRescued"
                              ? "bg-orange-100 text-orange-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {String(event.type || "")}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600">
                        Escrow: {String(event.escrowAddress || "").slice(0, 8)}
                        ...
                      </p>
                      <p className="text-xs text-gray-600">
                        Hashlock: {String(event.hashlock || "").slice(0, 8)}...
                      </p>
                      <p className="text-xs text-gray-600">
                        Block: {Number(event.blockNumber || 0)}
                      </p>
                      <p className="text-xs text-gray-600">
                        Chain: {Number(event.chainId || 0)}
                      </p>
                      {event.preimage && (
                        <p className="text-xs text-gray-600">
                          Preimage: {String(event.preimage).slice(0, 8)}...
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Withdraw Modal */}
        {selectedOrder && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h3 className="text-lg font-semibold mb-4">Withdraw Funds</h3>
              <p className="text-sm text-gray-600 mb-4">
                Enter the secret to withdraw funds from order:{" "}
                {selectedOrder.id.slice(0, 8)}...
              </p>
              <input
                type="text"
                placeholder="Secret (preimage)"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                className="border rounded px-3 py-2 w-full mb-4"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => withdrawFunds(selectedOrder)}
                  disabled={isWithdrawing || !secret}
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {isWithdrawing ? "Withdrawing..." : "Withdraw"}
                </button>
                <button
                  onClick={() => {
                    setSelectedOrder(null);
                    setSecret("");
                  }}
                  className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
