import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { assetAmount, assetToBase, baseAmount, getValueOfAssetInRune, getValueOfRuneInAsset, PoolData } from '@thorchain/asgardex-util';
import { Subscription } from 'rxjs';
import { environment } from 'src/environments/environment';
import { Asset } from '../_classes/asset';
import { MidgardService } from '../_services/midgard.service';
import { UserService } from '../_services/user.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmDepositModalComponent } from './confirm-deposit-modal/confirm-deposit-modal.component';
import { User } from '../_classes/user';
import { Balances } from '@xchainjs/xchain-client';
import { CGCoinListItem, CoinGeckoService } from '../_services/coin-gecko.service';
import { AssetAndBalance } from '../_classes/asset-and-balance';

@Component({
  selector: 'app-deposit',
  templateUrl: './deposit.component.html',
  styleUrls: ['./deposit.component.scss']
})
export class DepositComponent implements OnInit, OnDestroy {

  runeSymbol = environment.network === 'chaosnet' ? 'RUNE-B1A' : 'RUNE-67C';

  /**
   * Rune
   */
  rune: Asset;

  get runeAmount() {
    return this._runeAmount;
  }
  set runeAmount(val: number) {
    this._runeAmount = val;
  }
  _runeAmount: number;

  /**
   * Asset
   */
  set asset(val: Asset) {

    if (val) {

      if (!this._asset) {
        this._asset = val;
      } else {

        if (val.symbol !== this._asset.symbol) {
          this.router.navigate(['/', 'deposit', `${val.chain}.${val.symbol}`]);
          this._asset = val;
          this.assetBalance = this.userService.findBalance(this.balances, this.asset);
        }

      }

    }

  }
  get asset() {
    return this._asset;
  }
  _asset: Asset;
  get assetAmount() {
    return this._assetAmount;
  }
  set assetAmount(val: number) {

    this._assetAmount = val;

    if (val) {
      this.updateRuneAmount();
    } else {
      this.runeAmount = null;
    }

  }
  private _assetAmount: number;
  assetPoolData: PoolData;

  /**
   * Balances
   */
  balances: Balances;
  runeBalance: number;
  assetBalance: number;

  user: User;
  coinGeckoList: CGCoinListItem[];
  insufficientBnb: boolean;
  subs: Subscription[];
  selectableMarkets: AssetAndBalance[];

  constructor(
    private dialog: MatDialog,
    private userService: UserService,
    private router: Router,
    private route: ActivatedRoute,
    private midgardService: MidgardService,
    private cgService: CoinGeckoService
  ) {
    this.rune = new Asset(`BNB.${this.runeSymbol}`);

    const balances$ = this.userService.userBalances$.subscribe(
      (balances) => {
        this.balances = balances;
        this.runeBalance = this.userService.findBalance(this.balances, this.rune);
        this.assetBalance = this.userService.findBalance(this.balances, this.asset);

        // allows us to ensure enough bnb balance
        const bnbBalance = this.userService.findBalance(this.balances, new Asset('BNB.BNB'));
        this.insufficientBnb = bnbBalance < 0.000375;
      }
    );

    const user$ = this.userService.user$.subscribe(
      (user) => this.user = user
    );

    this.subs = [balances$, user$];

  }

  ngOnInit(): void {

    const params$ = this.route.paramMap.subscribe( (params) => {

      const asset = params.get('asset');

      if (asset) {
        this.asset = new Asset(asset);
        this.getPoolDetail(asset);
        this.assetBalance = this.userService.findBalance(this.balances, this.asset);
      }

    });

    this.getCoinGeckoCoinList();
    this.getPools();

    this.subs.push(params$);

  }

  getCoinGeckoCoinList() {
    this.cgService.getCoinList().subscribe( (res) => {
      this.coinGeckoList = res;
    });
  }

  updateRuneAmount() {

    const runeAmount = getValueOfAssetInRune(assetToBase(assetAmount(this.assetAmount)), this.assetPoolData);

    this.runeAmount = runeAmount.amount().div(10 ** 8 ).toNumber();

  }

  getPoolDetail(asset: string) {
    this.midgardService.getPoolDetails([asset], 'simple').subscribe(
      (res) => {

        if (res && res.length > 0) {

          this.assetPoolData = {
            assetBalance: baseAmount(res[0].assetDepth),
            runeBalance: baseAmount(res[0].runeDepth),
          };

        }
      },
      (err) => console.error('error getting pool detail: ', err)
    );
  }

  getPools() {
    this.midgardService.getPools().subscribe(
      (res) => {
        const sortedByName = res.sort();
        this.selectableMarkets = sortedByName.map((poolName) => ({
          asset: new Asset(poolName),
        }));

        // Keeping RUNE at top by default
        // this.selectableMarkets.unshift({
        //   asset: new Asset(
        //     environment.network === 'chaosnet' ? 'BNB.RUNE-B1A' : 'BNB.RUNE-67C'
        //   ),
        // });
      },
      (err) => console.error('error fetching pools:', err)
    );
  }

  formDisabled(): boolean {

    return !this.balances || !this.runeAmount || !this.assetAmount || this.insufficientBnb
    || (this.balances
      && (this.runeAmount > this.runeBalance || this.assetAmount > this.userService.maximumSpendableBalance(this.asset, this.assetBalance))
    );
  }

  mainButtonText(): string {

    if (!this.balances) {
      return 'Please connect wallet';
    } else if (this.balances && (!this.runeAmount || !this.assetAmount)) {
      return 'Enter an amount';
    } else if (this.balances && (this.runeAmount > this.runeBalance
      || this.assetAmount > this.userService.maximumSpendableBalance(this.asset, this.assetBalance))) {
      return 'Insufficient balance';
    } else if (this.insufficientBnb) {
      return 'Insufficient BNB for Fee';
    } else if (this.balances && this.runeAmount && this.assetAmount
      && (this.runeAmount <= this.runeBalance) && (this.assetAmount <= this.assetBalance)) {
      return 'Deposit';
    } else {
      console.warn('mismatch case for main button text');
      return;
    }
  }

  openConfirmationDialog() {

    const runeBasePrice = getValueOfAssetInRune(assetToBase(assetAmount(1)), this.assetPoolData).amount().div(10 ** 8).toNumber();
    const assetBasePrice = getValueOfRuneInAsset(assetToBase(assetAmount(1)), this.assetPoolData).amount().div(10 ** 8).toNumber();

    const dialogRef = this.dialog.open(
      ConfirmDepositModalComponent,
      {
        width: '50vw',
        maxWidth: '420px',
        minWidth: '260px',
        data: {
          asset: this.asset,
          rune: this.rune,
          assetAmount: this.assetAmount,
          runeAmount: this.runeAmount,
          user: this.user,
          runeBasePrice,
          assetBasePrice
        }
      }
    );

    dialogRef.afterClosed().subscribe( (transactionSuccess: boolean) => {

      if (transactionSuccess) {
        this.assetAmount = 0;
      }

    });
  }

  ngOnDestroy() {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
  }

}
