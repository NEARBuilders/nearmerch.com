import { authClient } from "@/lib/auth-client";
import { useNearAccountId } from "@/hooks/use-near-account-id";
import { clearFormPersistence } from "@/hooks/use-form-persistence";
import { clearPersistedCart } from "@/stores/cart-store";
import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  Outlet,
  useMatchRoute,
  useNavigate,
} from "@tanstack/react-router";
import { ChevronRight, Link2, Package, ArrowLeft, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_marketplace/_authenticated/account")({
  component: MyAccountPage,
  pendingComponent: () => null,
});

function MyAccountPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const { data: session } = authClient.useSession();

  const handleSignOut = async () => {
    try {
      await authClient.signOut();
      await authClient.near.disconnect();
      clearPersistedCart();
      clearFormPersistence();
      queryClient.invalidateQueries();
      toast.success("Signed out successfully");
      navigate({ to: "/" });
    } catch (error) {
      console.error("Sign out error:", error);
      toast.error("Failed to sign out");
    }
  };

  const accountId = useNearAccountId();
  const userEmail = session?.user?.email;
  const displayName = accountId || (userEmail && !userEmail.includes("http") ? userEmail : null) || "Account";
  const isOrdersActive = !!matchRoute({ to: "/account/orders" });
  const isConnectedActive = !!matchRoute({ to: "/account/connected" });

  return (
    <div className="bg-background min-h-screen pt-24 md:pt-32">
      <div className="max-w-[1408px] mx-auto px-4 md:px-8 lg:px-16">
        {/* Back and Account Header Blocks */}
        <div className="flex flex-row gap-2 md:gap-4 mb-6 md:mb-8">
          {/* Back Button */}
          <Link
            to="/"
            className="rounded-xl md:rounded-2xl border border-border/60 px-3 md:px-4 lg:px-8 py-3 md:py-4 lg:py-8 flex items-center justify-center hover:border-[#00EC97] hover:text-[#00EC97] transition-colors shrink-0"
          >
            <ArrowLeft className="size-4 md:size-5" />
        </Link>

          {/* Account Header Block */}
          <div className="flex-1 rounded-xl md:rounded-2xl bg-background border border-border/60 px-4 md:px-6 lg:px-8 py-4 md:py-6 lg:py-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
          <div className="min-w-0 flex-1">
                <h1 className="text-xl md:text-3xl lg:text-4xl font-bold tracking-tight mb-1 md:mb-2">My Account</h1>
                <div className="flex items-center gap-2 text-foreground/90 dark:text-muted-foreground text-xs md:text-sm">
              <svg
                className="size-3 md:size-4 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 16 16"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.33"
                  d="M13.333 14v-1.333A2.667 2.667 0 0010.666 10H5.333a2.667 2.667 0 00-2.666 2.667V14M8 7.333A2.667 2.667 0 108 2a2.667 2.667 0 000 5.333z"
                />
              </svg>
              <span className="truncate">{displayName}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
                className="px-4 md:px-8 py-2 md:py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center font-semibold text-sm md:text-base hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors shrink-0 whitespace-nowrap"
          >
            Sign Out
          </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:grid lg:grid-cols-[280px_1fr] gap-4 md:gap-6 lg:gap-8">
          <div className="flex flex-row lg:flex-col gap-2 lg:space-y-2 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0 -mx-4 md:-mx-0 px-4 md:px-0">
            <div className="lg:hidden w-full relative">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`w-full flex items-center justify-between gap-2 px-4 md:px-8 py-2 md:py-3 text-left transition-colors rounded-lg whitespace-nowrap bg-background/60 backdrop-blur-sm border border-border/60 text-foreground font-semibold text-sm md:text-base hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black ${
                      isOrdersActive || isConnectedActive
                        ? "bg-[#00EC97] border-[#00EC97] text-black"
                        : ""
                    }`}
                  >
                    <span className="text-sm md:text-base font-semibold">
                      {isOrdersActive ? "My Orders" : "Connected"}
                    </span>
                    <ChevronDown className="size-4 md:size-5 shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent 
                  align="start" 
                  alignOffset={-16}
                  sideOffset={8}
                  collisionPadding={16}
                  className="!w-[calc(100vw-2rem)] md:!w-full md:!max-w-none bg-background/80 backdrop-blur-sm border border-border/60 rounded-2xl px-6 py-4 shadow-lg"
                >
                  <div className="space-y-2">
                    <DropdownMenuItem asChild className="focus:bg-transparent hover:bg-transparent focus:text-[#00EC97] p-0">
                      <Link
                        to="/account/orders"
                        preload="intent"
                        preloadDelay={0}
                        className={`block text-sm font-semibold transition-colors px-3 py-2 rounded-lg ${
                          isOrdersActive ? 'text-[#00EC97]' : 'text-foreground hover:text-[#00EC97]'
                        }`}
                      >
                        My Orders
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="focus:bg-transparent hover:bg-transparent focus:text-[#00EC97] p-0">
                      <Link
                        to="/account/connected"
                        preload="intent"
                        preloadDelay={0}
                        className={`block text-sm font-semibold transition-colors px-3 py-2 rounded-lg ${
                          isConnectedActive ? 'text-[#00EC97]' : 'text-foreground hover:text-[#00EC97]'
                        }`}
                      >
                        Connected
                      </Link>
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="hidden lg:flex flex-col gap-2">
              <Link
                to="/account/orders"
                preload="intent"
                preloadDelay={0}
                className={`flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2 md:py-3 text-left transition-colors rounded-lg whitespace-nowrap shrink-0 ${
                  isOrdersActive
                    ? "bg-[#00EC97] border border-[#00EC97] text-black"
                    : "bg-background border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black"
                  }`}
              >
                <Package className="size-3 md:size-4 shrink-0" />
                <span className="text-xs md:text-sm font-semibold">My Orders</span>
                <ChevronRight className="size-3 md:size-4 shrink-0 hidden lg:block" />
              </Link>

              <Link
                to="/account/connected"
                preload="intent"
                preloadDelay={0}
                className={`flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2 md:py-3 text-left transition-colors rounded-lg whitespace-nowrap shrink-0 ${
                  isConnectedActive
                    ? "bg-[#00EC97] border border-[#00EC97] text-black"
                    : "bg-background border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black"
                  }`}
              >
                <Link2 className="size-3 md:size-4 shrink-0" />
                <span className="text-xs md:text-sm font-semibold">Connected</span>
                <ChevronRight className="size-3 md:size-4 shrink-0 hidden lg:block" />
              </Link>
            </div>
          </div>

          <div className="rounded-xl md:rounded-2xl bg-background border border-border/60 px-4 md:px-6 lg:px-8 py-4 md:py-6 lg:py-8 overflow-x-hidden min-w-0 max-w-full">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
