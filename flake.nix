{
  description = "Vue.js app dev environment with pnpm";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
    in {

      devShells.${system}.default = pkgs.mkShell {
        buildInputs = [
          pkgs.nodejs
          pkgs.pnpm
        ];

        shellHook = ''
          echo "Node.js version: $(node -v)"
          echo "pnpm version: $(pnpm -v)"
        '';
      };

      # Note: The playwright shell has not been tested yet.
      playwright = pkgs.mkShell {
        buildInputs = [
          pkgs.nodejs
          pkgs.pnpm
        ];
        nativeBuildInputs = with pkgs; [ playwright-driver.browsers ];
        shellHook = ''
          export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
          export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
        '';
      };

    };
}
