/*!
 * ${copyright}
 */

// Provides control sap.f.DynamicPage.
sap.ui.define([
	"jquery.sap.global",
	"./library",
	"sap/ui/core/Control",
	"sap/ui/core/ScrollBar",
	"sap/ui/core/ResizeHandler",
	"sap/ui/core/delegate/ScrollEnablement",
	"sap/ui/Device"
], function (jQuery, library, Control, ScrollBar, ResizeHandler, ScrollEnablement, Device) {
	"use strict";

	/**
	 * Constructor for a new Dynamic Page.
	 *
	 * @param {string} [sId] ID for the new control, generated automatically if no ID is given
	 * @param {object} [mSettings] Initial settings for the new control
	 *
	 * @class
	 * A DynamicPage is a control that is used as a layout for an application. It consists of a title, a header,
	 * content and a footer. Additionally it offers dynamic behavior when scrolling,
	 * where part of the header snaps to the title.
	 * Disclaimer: this control is in beta state - incompatible API changes may be done before its official public release. Use at your own discretion.
	 *
	 * @extends sap.ui.core.Control
	 *
	 * @author SAP SE
	 * @version ${version}
	 *
	 * @constructor
	 * @since 1.42
	 * @alias sap.f.DynamicPage
	 * @ui5-metamodel This control/element also will be described in the UI5 (legacy) designtime metamodel
	 */
	var DynamicPage = Control.extend("sap.f.DynamicPage", /** @lends sap.f.DynamicPage.prototype */ {
		metadata: {
			library: "sap.f",
			properties: {

				/**
				 * Determines whether the header is always expanded when scrolling.
				 * <b>Note:</b> Based on internal rules, the value of the property is not always taken into account - for example
				 * when the control is rendered on tablet or mobile and the control`s title and header
				 * are with height bigger than given threshold.
				 * @since 1.42
				 */
				headerAlwaysExpanded: {type: "boolean", group: "Behaviour", defaultValue: false},

				/**
				 * Determines whether the header is expanded.
				 * <b>Note:</b> Based on internal rules, the value of the property is not always taken into account - for example
				 * when the expanded header is larger than the available screen area. For those cases a warning is logged.
				 * The header can be also expanded/collapsed by user interaction, which requires the property to be
				 * internally mutated by the control to reflect the changed state.
				 */
				headerExpanded: {type: "boolean", group: "Behaviour", defaultValue: true},

				/**
				 * Determines whether the footer will be visible.
				 */
				showFooter: {type: "boolean", group: "Behaviour", defaultValue: false}
			},
			aggregations: {
				/**
				 * Dynamic Page Layout Title managed internally by the DynamicPage control.
				 */
				title: {type: "sap.f.DynamicPageTitle", multiple: false},

				/**
				 * Dynamic Page Layout Header.
				 */
				header: {type: "sap.f.ISnappable", multiple: false},

				/**
				 * Dynamic Page Layout Content.
				 */
				content: {type: "sap.ui.core.Control", multiple: false},

				/**
				 * Dynamic Page Layout Floating Footer.
				 */
				footer: {type: "sap.m.IBar", multiple: false},

				/**
				 * Dynamic Page Layout Custom ScrollBar.
				 */
				_scrollBar: {type: "sap.ui.core.ScrollBar", multiple: false, visibility: "hidden"}
			}
		}
	});

	function exists(vObject) {
		if (arguments.length === 1) {
			return Array.isArray(vObject) ? vObject.length > 0 : !!vObject;
		}

		return Array.prototype.slice.call(arguments).every(function (oObject) {
			return exists(oObject);
		});
	}

	var bUseAnimations = sap.ui.getCore().getConfiguration().getAnimation();

	/**
	 * STATIC MEMBERS
	 */
	DynamicPage.HEADER_MAX_ALLOWED_PINNED_PERCENTAGE = 0.6;

	DynamicPage.HEADER_MAX_ALLOWED_NON_SROLLABLE_PERCENTAGE = 0.6;

	DynamicPage.FOOTER_ANIMATION_DURATION = 350;

	DynamicPage.BREAK_POINTS = {
		TABLET: 1024,
		PHONE: 600
	};

	DynamicPage.EVENTS = {
		TITLE_PRESS: "_titlePress",
		PIN_UNPIN_PRESS: "_pinUnpinPress"
	};

	DynamicPage.MEDIA = {
		INVISIBLE: "sapUiHidden",
		PHONE: "sapFDynamicPage-Std-Phone",
		TABLET: "sapFDynamicPage-Std-Tablet",
		DESKTOP: "sapFDynamicPage-Std-Desktop"
	};

	DynamicPage.RESIZE_HANDLER_ID = {
		PAGE: "_sResizeHandlerId",
		TITLE: "_sTitleResizeHandlerId",
		CONTENT: "_sContentResizeHandlerId"
	};

	/**
	 * LIFECYCLE METHODS
	 */
	DynamicPage.prototype.init = function () {
		this._bPinned = false;
		this._bHeaderInTitleArea = false;
		this._bExpandingWithAClick = false;
		this._headerBiggerThanAllowedHeight = false;
		this._oScrollHelper = new ScrollEnablement(this, this.getId() + "-content", {
			horizontal: false,
			vertical: true
		});
	};

	DynamicPage.prototype.onBeforeRendering = function () {
		if (!this._headerAlwaysExpanded()) {
			this._attachPinPressHandler();
		}

		this._attachTitlePressHandler();
		this._detachScrollHandler();
	};

	DynamicPage.prototype.onAfterRendering = function () {
		var bHeaderAlwaysExpanded = this._headerAlwaysExpanded(),
			oDynamicPageHeader = this.getHeader();

		if (bHeaderAlwaysExpanded && exists(oDynamicPageHeader)) {
			oDynamicPageHeader._setShowPinBtn(false);
			// Ensure that in this tick DP and it's aggregations are rendered
			jQuery.sap.delayedCall(0, this, this._overrideHeaderAlwaysExpanded);
		}

		this._cacheDomElements();
		this._detachResizeHandlers();
		this._attachResizeHandlers();
		this._updateMedia(this._getWidth(this));
		this._attachScrollHandler();
		this._updateScrollBar();
		this._attachPageChildrenAfterRenderingDelegates();
	};

	DynamicPage.prototype.exit = function () {
		this._detachResizeHandlers();
		if (this._oScrollHelper) {
			this._oScrollHelper.destroy();
		}
	};

	DynamicPage.prototype.setShowFooter = function (bShowFooter) {
		var vResult = this.setProperty("showFooter", bShowFooter, true);
		this._toggleFooter(bShowFooter);
		return vResult;
	};

	DynamicPage.prototype.setHeaderExpanded = function (bHeaderExpanded) {
		if (this.getHeaderExpanded() === bHeaderExpanded) {
			return this;
		}

		this._titleExpandCollapseWhenAllowed();
		return this;
	};

	DynamicPage.prototype.setHeaderAlwaysExpanded = function (bHeaderAlwaysExpanded) {
		var vResult = this.setProperty("headerAlwaysExpanded", bHeaderAlwaysExpanded, false);

		if (bHeaderAlwaysExpanded) {
			this.setProperty("headerExpanded", true, true);
		}

		return vResult;
	};

	DynamicPage.prototype.getScrollDelegate = function () {
		return this._oScrollHelper;
	};

	/**
	 * PRIVATE METHODS
	 */

	/**
	 * If the header is bigger than the allowed height the control will be invalidated and rendered with scrollable header
	 * @private
	 * @returns {boolean} is rule overridden
	 */
	DynamicPage.prototype._overrideHeaderAlwaysExpanded = function () {
		if (!this._shouldOverrideHeaderAlwaysExpanded()) {
			this._headerBiggerThanAllowedHeight = false;
			return;
		}

		this._headerBiggerThanAllowedHeight = true;
		this._moveHeaderToContentArea();
		this._updateScrollBar();
	};

	/**
	 * Determines if the headerAlwaysExpanded should be overridden
	 * @private
	 * @returns {boolean}
	 */
	DynamicPage.prototype._shouldOverrideHeaderAlwaysExpanded = function () {
		return !Device.system.desktop && this._headerBiggerThanAllowedToBeFixed() && this._headerAlwaysExpanded();
	};

	/**
	 * Hide/show the footer container
	 * @param bShow
	 * @private
	 */
	DynamicPage.prototype._toggleFooter = function (bShow) {
		var oFooter = this.getFooter();

		if (!exists(oFooter)) {
			return;
		}

		oFooter.toggleStyleClass("sapFDynamicPageActualFooterControlShow", bShow);
		oFooter.toggleStyleClass("sapFDynamicPageActualFooterControlHide", !bShow);

		this._toggleFooterSpacer(bShow);

		if (bUseAnimations){
			if (!bShow) {
				jQuery.sap.delayedCall(DynamicPage.FOOTER_ANIMATION_DURATION, this, function () {
					this.$footerWrapper.toggleClass("sapUiHidden", !this.getShowFooter());
				});
			} else {
				this.$footerWrapper.toggleClass("sapUiHidden", !this.getShowFooter());
			}

			jQuery.sap.delayedCall(DynamicPage.FOOTER_ANIMATION_DURATION, this, function () {
				oFooter.removeStyleClass("sapFDynamicPageActualFooterControlShow");
			});
		}

		this._updateScrollBar();
	};

	/**
	 * Hide/show the footer spacer
	 * @param {boolean} bToggle
	 * @private
	 */
	DynamicPage.prototype._toggleFooterSpacer = function (bToggle) {
		var $footerSpacer = this.$("spacer");

		if (exists($footerSpacer)) {
			$footerSpacer.toggleClass("sapFDynamicPageContentWrapperSpacer", bToggle);
			this.$('contentFitContainer').css("bottom", bToggle ? "4rem" : 0);
		}
	};

	/**
	 * Switches between snapped/expanded modes
	 * @private
	 */
	DynamicPage.prototype._toggleHeader = function () {
		if (this._shouldSnap()) {
			this._snapHeader(true);
			this._updateHeaderARIAState(false);

		} else if (this._shouldExpand()) {

			this._expandHeader();
			this._updateHeaderARIAState(true);

		} else if (!this._bPinned && this._bHeaderInTitleArea) {
			this._moveHeaderToContentArea();
		}
	};

	/**
	 * Converts the header to snapped mode
	 * @param {boolean} bAppendHeaderToContent
	 * @private
	 */

	DynamicPage.prototype._snapHeader = function (bAppendHeaderToContent) {
		var oDynamicPageTitle = this.getTitle();

		if (this._bPinned) {
			jQuery.sap.log.debug("DynamicPage :: aborted snapping, header is pinned", this);
			return;
		}

		jQuery.sap.log.debug("DynamicPage :: snapped header", this);

		if (exists(oDynamicPageTitle)) {
			if (exists(oDynamicPageTitle.getExpandedContent())) {
				oDynamicPageTitle._setShowExpandContent(false);
			}

			if (exists(oDynamicPageTitle.getSnappedContent())) {
				oDynamicPageTitle._setShowSnapContent(true);
			}

			if (bAppendHeaderToContent) {
				this._moveHeaderToContentArea();
			}
		}

		if (!exists(this.$titleArea)) {
			jQuery.sap.log.warning("DynamicPage :: couldn't snap header. There's no title.", this);
			return;
		}

		this.setProperty("headerExpanded", false, true);
		this.$titleArea.addClass("sapFDynamicPageTitleSnapped");
	};

	/**
	 * Converts the header to expanded mode
	 * @param {boolean} bAppendHeaderToTitle
	 * @private
	 */
	DynamicPage.prototype._expandHeader = function (bAppendHeaderToTitle) {
		var oDynamicPageTitle = this.getTitle();
		jQuery.sap.log.debug("DynamicPage :: expand header", this);

		if (exists(oDynamicPageTitle)) {
			if (exists(oDynamicPageTitle.getExpandedContent())) {
				oDynamicPageTitle._setShowExpandContent(true);
			}
			if (exists(oDynamicPageTitle.getSnappedContent())) {
				oDynamicPageTitle._setShowSnapContent(false);
			}

			if (bAppendHeaderToTitle) {
				this._moveHeaderToTitleArea();
			}
		}

		if (!exists(this.$titleArea)) {
			jQuery.sap.log.warning("DynamicPage :: couldn't expand header. There's no title.", this);
			return;
		}

		this.setProperty("headerExpanded", true, true);
		this.$titleArea.removeClass("sapFDynamicPageTitleSnapped");
	};

	/**
	 * Toggles the header visibility in such a way, that the page content is pushed down or pulled up.
	 * The method is used, when headerAlwaysExpanded is true
	 * @param {boolean} bShow
	 * @private
	 */
	DynamicPage.prototype._toggleHeaderVisibility = function (bShow) {
		var bExpanded = this.getHeaderExpanded(),
			oDynamicPageTitle = this.getTitle(),
			oDynamicPageHeader = this.getHeader();

		if (this._bPinned) {
			jQuery.sap.log.debug("DynamicPage :: header toggle aborted, header is pinned", this);
			return;
		}

		if (exists(oDynamicPageTitle)) {
			oDynamicPageTitle._setShowExpandContent(bExpanded);
			oDynamicPageTitle._setShowSnapContent(!bExpanded);
		}

		if (exists(oDynamicPageHeader)) {
			oDynamicPageHeader.$().toggleClass("sapFDynamicPageHeaderHidden", !bShow);
			this._updateScrollBar();
		}
	};

	/**
	 * Appends header to content area
	 * @private
	 */
	DynamicPage.prototype._moveHeaderToContentArea = function () {
		var oDynamicPageHeader = this.getHeader();

		if (exists(oDynamicPageHeader)) {
			oDynamicPageHeader.$().prependTo(this.$wrapper);
			this._bHeaderInTitleArea = false;
		}
	};

	/**
	 * Appends header to title area
	 * @private
	 */
	DynamicPage.prototype._moveHeaderToTitleArea = function () {
		var oDynamicPageHeader = this.getHeader();

		if (exists(oDynamicPageHeader)) {
			oDynamicPageHeader.$().appendTo(this.$titleArea);
			this._bHeaderInTitleArea = true;
		}
	};

	/**
	 * Scrolls the content to the snap point(header`s height + 1)
	 * @private
	 */
	DynamicPage.prototype._scrollToSnapHeader = function () {
		this._setScrollPosition(this._getSnappingHeight() + 1);
	};

	/**
	 * Pins the header
	 * @private
	 */
	DynamicPage.prototype._pin = function () {
		if (!this._bPinned) {
			this._bPinned = true;
			this._moveHeaderToTitleArea();
			this._updateScrollBar();
			this.getHeader()._updateARIAPinButtonState(this._bPinned);
		}
	};

	/**
	 * Unpins the header
	 * @private
	 */
	DynamicPage.prototype._unPin = function () {
		if (this._bPinned) {
			this._bPinned = false;
			this.getHeader()._updateARIAPinButtonState(this._bPinned);
		}
	};

	/**
	 * Restores the Header Pin Button`s focus.
	 * @private
	 */
	DynamicPage.prototype._restorePinButtonFocus = function () {
		this.getHeader()._focusPinButton();
	};

	/**
	 * Determines the appropriate position of the ScrollBar based on what the device is.
	 * @returns {Number}
	 * @private
	 */
	DynamicPage.prototype._getScrollPosition = function () {
		if (Device.system.desktop) {
			return this._getScrollBar().getScrollPosition();
		} else {
			return this.$wrapper.scrollTop();
		}
	};

	/**
	 * Sets the appropriate scroll position of the ScrollBar and DynamicPage content wrapper,
	 * based on what the device
	 * @param {Number} iNewScrollPosition
	 * @private
	 */
	DynamicPage.prototype._setScrollPosition = function (iNewScrollPosition) {
		if (exists(this.$wrapper)) {
			this.$wrapper.scrollTop(iNewScrollPosition);
			Device.system.desktop && this._getScrollBar().setScrollPosition(iNewScrollPosition);
		}
	};

	/**
	 * Determines if the header should snap
	 * @returns {boolean}
	 * @private
	 */
	DynamicPage.prototype._shouldSnap = function () {
		return !this._headerAlwaysExpanded() && this._getScrollPosition() > this._getSnappingHeight()
			&& this.getHeaderExpanded() && !this._bPinned;
	};

	/**
	 * Determines if the header should expand
	 * @returns {boolean}
	 * @private
	 */
	DynamicPage.prototype._shouldExpand = function () {
		return !this._headerAlwaysExpanded() && this._getScrollPosition() < this._getSnappingHeight()
			&& !this.getHeaderExpanded() && !this._bPinned;
	};

	/**
	 * Determines if the header is scrolled out completely
	 * @returns {boolean}
	 * @private
	 */
	DynamicPage.prototype._headerScrolledOut = function () {
		return this._getScrollPosition() > this._getSnappingHeight();
	};

	/**
	 * Determines if the header is allowed to snap,
	 * it`s not pinned, not already snapped and snap on scroll is allowed
	 * @returns {boolean}
	 * @private
	 */
	DynamicPage.prototype._headerSnapAllowed = function () {
		return !this._headerAlwaysExpanded() && this.getHeaderExpanded() && !this._bPinned;
	};
	/**
	 * Determines if it's possible for the header to snap via scroll
	 * @returns {boolean}
	 * @private
	 */
	DynamicPage.prototype._canSnapHeaderOnScroll = function () {
		return this._getMaxScrollPosition() > (this._getSnappingHeight() + 1);
	};

	/**
	 * Determines the appropriate height at which the header can snap
	 * @returns {Number}
	 * @private
	 */
	DynamicPage.prototype._getSnappingHeight = function () {
		return this._getHeaderHeight() || this._getTitleHeight();
	};

	/**
	 * Determines the maximum scroll position, depending on the content size
	 * @returns {Number}
	 * @private
	 */
	DynamicPage.prototype._getMaxScrollPosition = function() {
		var $wrapperDom;

		if (exists(this.$wrapper)) {
			$wrapperDom = this.$wrapper[0];
			return $wrapperDom.scrollHeight - Math.ceil($wrapperDom.getBoundingClientRect().height);
		}
		return 0;
	};

	/**
	 * Determines if the control would need a ScrollBar.
	 * @returns {boolean}
	 * @private
	 */
	DynamicPage.prototype._needsVerticalScrollBar = function () {
		return this._getMaxScrollPosition() > 0;
	};

	/**
	 * Retrieves the height of the Dynamic Page control
	 * @returns {Number}
	 * @private
	 */
	DynamicPage.prototype._getOwnHeight = function () {
		return this._getHeight(this);
	};

	/**
	 * Determines the combined height of the title and the header
	 * @returns {Number} the combined height of the title and the header
	 * @private
	 */
	DynamicPage.prototype._getEntireHeaderHeight = function () {
		var iTitleHeight = 0,
			iHeaderHeight = 0,
			oDynamicPageTitle = this.getTitle(),
			oDynamicPageHeader = this.getHeader();

		if (exists(oDynamicPageTitle)) {
			iTitleHeight = oDynamicPageTitle.$().outerHeight();
		}

		if (exists(oDynamicPageHeader)) {
			iHeaderHeight = oDynamicPageHeader.$().outerHeight();
		}

		return iTitleHeight + iHeaderHeight;
	};

	/**
	 * Determines if the header is bigger than what's allowed for it to snap.
	 * If the header becomes more than the screen height, it shouldn't be snapped while scrolling.
	 * @returns {boolean}
	 * @private
	 */
	DynamicPage.prototype._headerBiggerThanAllowedToExpandWithACommand = function () {
		return this._getEntireHeaderHeight() > this._getOwnHeight();
	};

	/**
	 * Determines if the header is bigger than what's allowed for it to be pinned.
	 * If the header becomes more than 60% of the screen height it cannot be pinned.
	 * @param {Number} iControlHeight
	 * @returns {boolean}
	 * @private
	 */
	DynamicPage.prototype._headerBiggerThanAllowedToPin = function (iControlHeight) {
		if (!(typeof iControlHeight === "number" && !isNaN(parseInt(iControlHeight, 10)))) {
			iControlHeight = this._getOwnHeight();
		}

		return this._getEntireHeaderHeight() > DynamicPage.HEADER_MAX_ALLOWED_PINNED_PERCENTAGE * iControlHeight;
	};

	/*
	 * Determines if the header is bigger than the allowed height
	 * @returns {boolean}
	 * @private
	 */
	DynamicPage.prototype._headerBiggerThanAllowedToBeFixed = function () {
		var iControlHeight = this._getOwnHeight();

		return this._getEntireHeaderHeight() > DynamicPage.HEADER_MAX_ALLOWED_NON_SROLLABLE_PERCENTAGE * iControlHeight;
	};

	/**
	 * Determines the height that is needed to correctly offset the "fake" ScrollBar in none header not always expanded mode
	 * @returns {Number}
	 * @private
	 */
	DynamicPage.prototype._measureScrollBarOffsetHeight = function () {
		var iHeight = 0,
			bSnapped = !this.getHeaderExpanded(),
			bHeaderAlwaysExpanded = this._headerAlwaysExpanded();

		if (bHeaderAlwaysExpanded || this._bPinned) {
			iHeight = this._getTitleAreaHeight();
			jQuery.sap.log.debug("DynamicPage :: header always expanded or header pinned :: title area height" + iHeight, this);
			return iHeight;
		}

		if (bSnapped || !exists(this.getTitle()) || !this._canSnapHeaderOnScroll()) {
			iHeight = this._getTitleHeight();
			jQuery.sap.log.debug("DynamicPage :: header snapped :: title height " + iHeight, this);
			return iHeight;
		}

		this._snapHeader(true);

		iHeight = this._getTitleHeight();

		if (this._shouldExpand() && !bSnapped) {
			this._expandHeader();
		}

		jQuery.sap.log.debug("DynamicPage :: snapped mode :: title height " + iHeight, this);
		return iHeight;
	};

	/**
	 * Updates the position/height of the "fake" ScrollBar
	 * @private
	 */
	DynamicPage.prototype._updateScrollBar = function () {
		var oScrollBar,
			bScrollBarNeeded;

		if (!Device.system.desktop || !exists(this.$wrapper)) {
			return;
		}

		bScrollBarNeeded = this._needsVerticalScrollBar();
		oScrollBar = this._getScrollBar();
		oScrollBar.setContentSize(this._measureScrollBarOffsetHeight() + this.$wrapper[0].scrollHeight + "px");
		oScrollBar.toggleStyleClass("sapUiHidden", !bScrollBarNeeded);
		this.toggleStyleClass("sapFDynamicPageWithScroll", bScrollBarNeeded);

		jQuery.sap.delayedCall(0, this, this._updateScrollBarOffset);
		jQuery.sap.delayedCall(0, this, this._updateFitContainer);
	};

	DynamicPage.prototype._updateFitContainer = function () {
		this.$contentFitContainer.toggleClass('sapFDynamicPageContentFitContainer', !this._needsVerticalScrollBar());
	};


	/**
	 * Updates the title area/footer offset. Since the "real" scroll bar starts at just below the title and since the "fake"
	 * ScrollBar doesn't shift the content of the title/footer, it is necessary to offset this ourselves, so it looks natural.
	 * @private
	 */
	DynamicPage.prototype._updateScrollBarOffset = function () {
		var sStyleAttribute = sap.ui.getCore().getConfiguration().getRTL() ? "left" : "right",
			iOffsetWidth = this._needsVerticalScrollBar() ? jQuery.position.scrollbarWidth() + "px" : 0,
			oFooter = this.getFooter();

		this.$titleArea.css("padding-" + sStyleAttribute, iOffsetWidth);
		if (exists(oFooter)) {
			oFooter.$().css(sStyleAttribute, iOffsetWidth);
		}
	};

	/**
	 * Updates the Header ARIA state according to Header Expanded / Snapped state.
	 * @param {Boolean} bExpanded determines if the header is expanded or snapped.
	 * @private
	 */
	DynamicPage.prototype._updateHeaderARIAState = function (bExpanded) {
		var oDynamicPageHeader = this.getHeader();

		if (exists(oDynamicPageHeader)) {
			oDynamicPageHeader._updateARIAState(bExpanded);
		}
	};

	/**
	 * Updates the media size of the control based on its own width, not on the entire screen size (which media query does).
	 * This is necessary, because the control will be embedded in other controls (like the sap.f.FlexibleColumnLayout),
	 * thus it will not be using all of the screens width, but despite that the paddings need to be appropriate.
	 * @param {Number} iWidth - the actual width of the control
	 * @private
	 */
	DynamicPage.prototype._updateMedia = function (iWidth) {
		if (iWidth === 0) {
			this._updateMediaStyle(DynamicPage.MEDIA.INVISIBLE);
		} else if (iWidth <= DynamicPage.BREAK_POINTS.PHONE) {
			this._updateMediaStyle(DynamicPage.MEDIA.PHONE);
		} else if (iWidth <= DynamicPage.BREAK_POINTS.TABLET) {
			this._updateMediaStyle(DynamicPage.MEDIA.TABLET);
		} else {
			this._updateMediaStyle(DynamicPage.MEDIA.DESKTOP);
		}
	};

	/**
	 * It puts the appropriate classes on the control based on the current media size.
	 * @param {string} sCurrentMedia
	 * @private
	 */
	DynamicPage.prototype._updateMediaStyle = function (sCurrentMedia) {
		Object.keys(DynamicPage.MEDIA).forEach(function (sMedia) {
			var bEnable = sCurrentMedia === DynamicPage.MEDIA[sMedia];
			this.toggleStyleClass(DynamicPage.MEDIA[sMedia], bEnable);
		}, this);
	};

	/**
	 * Determines the height of a control safely. If the control doesn't exist it returns 0,
	 * so it doesn't confuse any calculations based on it. If it exists it just returns its dom element height.
	 * @param  {sap.ui.core.Control} oControl
	 * @return {Number} the height of the control
	 */
	DynamicPage.prototype._getHeight = function (oControl) {
		return !(oControl instanceof Control) ? 0 : oControl.$().outerHeight() || 0;
	};

	/**
	 * Determines the width of a control safely. If the control doesn't exist it returns 0,
	 * so it doesn't confuse any calculations based on it. If it exists it just returns its dom element width.
	 * @param  {sap.ui.core.Control} oControl
	 * @return {Number} the width of the control
	 */
	DynamicPage.prototype._getWidth = function (oControl) {
		return !(oControl instanceof Control) ? 0 : oControl.$().outerWidth() || 0;
	};

	/**
	 * Determines the height of the DynamicPage`s outer header DOM element (the so called title area),
	 * the wrapper of the DynamicPageTitle and DynamicPageHeader.
	 * @returns {Number}
	 * @private
	 */
	DynamicPage.prototype._getTitleAreaHeight = function () {
		return exists(this.$titleArea) ? this.$titleArea.outerHeight() || 0 : 0;
	};

	/**
	 * Determines the height of the Title, if it's not present it returns 0
	 * @returns {Number}
	 * @private
	 */
	DynamicPage.prototype._getTitleHeight = function () {
		return this._getHeight(this.getTitle());
	};

	/**
	 * Determines the height of the Header, if it's not present it returns 0
	 * @returns {Number}
	 * @private
	 */
	DynamicPage.prototype._getHeaderHeight = function () {
		return this._getHeight(this.getHeader());
	};

	/**
	 * Determines if the presence of scroll (on the control itself) is allowed.
	 * @returns {boolean}
	 * @private
	 */
	DynamicPage.prototype._headerAlwaysExpanded = function () {
		return this.getHeaderAlwaysExpanded() && !this._headerBiggerThanAllowedHeight;
	};

	/**
	 * Lazily retrieves the "fake" scrollbar
	 * @returns {sap.ui.core.ScrollBar} - the "fake" scrollbar
	 * @private
	 */
	DynamicPage.prototype._getScrollBar = function () {
		if (!exists(this.getAggregation("_scrollBar"))) {
			var oVerticalScrollBar = new ScrollBar(this.getId() + "-vertSB", {
				vertical: true,
				size: "100%",
				scrollPosition: 0,
				scroll: this._onScrollBarScroll.bind(this)
			});
			this.setAggregation("_scrollBar", oVerticalScrollBar, true);
		}

		return this.getAggregation("_scrollBar");
	};

	/**
	 * Caches the DynamicPage DOM elements in a jQuery object for later reuse
	 * @private
	 */
	DynamicPage.prototype._cacheDomElements = function () {
		var oFooter = this.getFooter();

		if (exists(oFooter)) {
			this.$footer = oFooter.$();
			this.$footerWrapper = this.$("footerWrapper");
		}

		this.$wrapper = this.$("contentWrapper");
		this.$contentFitContainer = this.$('contentFitContainer');
		this.$titleArea = this.$("header");

		this._cacheTitleDom();
	};

	/**
	 * Caches the DynamicPageTitle DOM element as jQuery object for later reuse,
	 * used when DynamicPageTitle is re-rendered (_onChildControlAfterRendering method) to ensure the DynamicPageTitle DOM reference
	 * is the current one.
	 * @private
	 */
	DynamicPage.prototype._cacheTitleDom = function () {
		var oTitle = this.getTitle();

		if (exists(oTitle)) {
			this.$title = oTitle.$();
		}
	};

	/**
	 * EVENT HANDLERS
	 */

	/**
	 * Mark the event for components that need to know if the event was handled.
	 * This allows drag scrolling of the control
	 * @param {jQuery.Event} oEvent
	 */
	DynamicPage.prototype.ontouchmove = function (oEvent) {
		oEvent.setMarked();
	};

	/**
	 * Reacts to DynamicPage child controls re-rendering, updating the ScrollBar size.
	 * In case DynamicPageTitle is re-rendering, the DynamicPageTitle DOM reference and resize handlers should be also updated.
	 * @param {jQuery.Event} oEvent
	 * @private
	 */
	DynamicPage.prototype._onChildControlAfterRendering = function (oEvent) {
		if (oEvent.srcControl instanceof sap.f.DynamicPageTitle ) {
			this._cacheTitleDom();
			this._deRegisterResizeHandler(DynamicPage.RESIZE_HANDLER_ID.TITLE);
			this._registerResizeHandler(DynamicPage.RESIZE_HANDLER_ID.TITLE, this.$title[0], this._onChildControlsHeightChange.bind(this));
		}
		jQuery.sap.delayedCall(0, this, this._updateScrollBar);
	};


	/**
	 * React when the aggregated child controls are changes its height in order to adjust the update the scrollbar.
	 * @param {jQuery.Event} oEvent
	 * @private
	 */
	DynamicPage.prototype._onChildControlsHeightChange = function (oEvent) {
		if (oEvent.size.height !== oEvent.oldSize.height && !this._bExpandingWithAClick) {
			this._updateScrollBar();
		}

		this._bExpandingWithAClick = false;
	};

	/**
	 * Handles the resize event of the DynamicPage.
	 * It unpins the header if it has reached it's threshold, it updates the "fake" scroll height.
	 * @param {jQuery.Event} oEvent
	 * @private
	 */
	DynamicPage.prototype._onResize = function (oEvent) {
		var oDynamicPageHeader = this.getHeader();

		if (!this._headerAlwaysExpanded() && oDynamicPageHeader) {
			if (this._headerBiggerThanAllowedToPin(oEvent.size.height) || Device.system.phone) {
				this._unPin();
				oDynamicPageHeader._setShowPinBtn(false);
				oDynamicPageHeader._togglePinButton(false);
			} else {
				oDynamicPageHeader._setShowPinBtn(true);
			}
		}

		this._updateScrollBar();
		this._updateMedia(oEvent.size.width);
	};

	/**
	 * Handles the scrolling on the content.
	 * @param {jQuery.Event} oEvent
	 * @private
	 */
	DynamicPage.prototype._onWrapperScroll = function (oEvent) {
		if (!Device.system.desktop || !this._bExpandingWithAClick) {
			this._toggleHeader();
		}

		if (Device.system.desktop) {
			if (this.allowCustomScroll === true && oEvent.target.scrollTop > 0) {
				this.allowCustomScroll = false;
				return;
			}

			this.allowInnerDiv = true;
			this._getScrollBar().setScrollPosition(oEvent.target.scrollTop);
			this.toggleStyleClass("sapFDynamicPageWithScroll", this._needsVerticalScrollBar());
		}
	};

	/**
	 * Handles the scrolling on the "fake" scrollbar.
	 * @private
	 */
	DynamicPage.prototype._onScrollBarScroll = function () {
		this._toggleHeader();

		if (this.allowInnerDiv === true) {
			this.allowInnerDiv = false;
			return;
		}

		this.allowCustomScroll = true;
		this.$wrapper.scrollTop(this._getScrollBar().getScrollPosition());
	};

	/**
	 * Еxpands/collapses the header when allowed to do so by the internal rules of the <code>DynamicPage</code>.
	 * @private
	 */
	DynamicPage.prototype._titleExpandCollapseWhenAllowed = function () {
		if (this._headerBiggerThanAllowedToExpandWithACommand()) {
			jQuery.sap.log.warning("DynamicPage :: couldn't expand header. There isn't enough space for it to fit on the screen", this);
			return;
		}

		// Header scrolling is not allowed or there is no enough content scroll bar to appear
		if (this._headerAlwaysExpanded() || !this._needsVerticalScrollBar()) {
			if (!this.getHeaderExpanded()) {
				// Show header, pushing the content down
				this._expandHeader(false);
				this._toggleHeaderVisibility(true);
			} else {
				// Hide header, pulling the content up
				this._snapHeader(false);
				this._toggleHeaderVisibility(false);
			}

		} else if (!this.getHeaderExpanded()) {
			// Header is already snapped, then expand
			this._bExpandingWithAClick = true;
			this._expandHeader(true);

		} else if (this._headerSnapAllowed()) {

			if (this._headerScrolledOut()) {
				// Header is scrolled out completely, then snap
				this._snapHeader(true);
			} else if (this._canSnapHeaderOnScroll()){
				// Header is not scrolled out completely, then scroll to snap
				this._scrollToSnapHeader();
			} else {
				jQuery.sap.log.warning("DynamicPage :: couldn't snap header. There isn't enough content to be scrolled", this);
			}
		}
	};

	/**
	 * Handles the pin/unpin button press event, which results in the pinning/unping of the header.
	 * @private
	 */
	DynamicPage.prototype._onPinUnpinButtonPress = function (oEvent) {
		if (this._bPinned) {
			this._unPin(oEvent);
		} else {
			this._pin(oEvent);
			this._restorePinButtonFocus();
		}
	};


	/**
	 * ATTACH/DETACH HANDLERS
	 */

	/**
	 * Attaches resize handlers on DynamicPage, DynamicPageTitle DOM Element and DynamicPageContent DOM Element
	 * @private
	 */
	DynamicPage.prototype._attachResizeHandlers = function () {
		var fnChildControlSizeChangeHandler = this._onChildControlsHeightChange.bind(this);

		this._registerResizeHandler(DynamicPage.RESIZE_HANDLER_ID.PAGE, this, this._onResize.bind(this));

		if (exists(this.$title)) {
			this._registerResizeHandler(DynamicPage.RESIZE_HANDLER_ID.TITLE, this.$title[0], fnChildControlSizeChangeHandler);
		}

		if (exists(this.$contentFitContainer)) {
			this._registerResizeHandler(DynamicPage.RESIZE_HANDLER_ID.CONTENT, this.$contentFitContainer[0], fnChildControlSizeChangeHandler);
		}
	};

	/**
	 * Registers resize handler
	 * @param {string} sHandler the handler ID
	 * @param {Object} oObject
	 * @param {Function} fnHandler
	 * @private
	 */
	DynamicPage.prototype._registerResizeHandler = function (sHandler, oObject, fnHandler) {
		if (!this[sHandler]) {
			this[sHandler] = ResizeHandler.register(oObject, fnHandler);
		}
	};

	/**
	 * Detaches resize handlers on DynamicPage, DynamicPAgeTitle DOM Element and DynamicPageContent DOM Element
	 * @private
	 */
	DynamicPage.prototype._detachResizeHandlers = function () {
		this._deRegisterResizeHandler(DynamicPage.RESIZE_HANDLER_ID.PAGE);
		this._deRegisterResizeHandler(DynamicPage.RESIZE_HANDLER_ID.TITLE);
		this._deRegisterResizeHandler(DynamicPage.RESIZE_HANDLER_ID.CONTENT);
	};

	/**
	 * De-registers resize handler
	 * @param {string} sHandler the handler ID
	 * @private
	 */
	DynamicPage.prototype._deRegisterResizeHandler = function (sHandler) {
		if (this[sHandler]) {
			ResizeHandler.deregister(this[sHandler]);
			this[sHandler] = null;
		}
	};

	/**
	 * Attaches a delegate for DynamicPage's child controls 'onAfterRendering' lifecycle events
	 * @private
	 */
	DynamicPage.prototype._attachPageChildrenAfterRenderingDelegates = function () {
		var oTitle = this.getTitle(),
			oContent = this.getContent(),
			oPageChildrenAfterRenderingDelegate = {onAfterRendering: this._onChildControlAfterRendering.bind(this)};

		if (exists(oTitle)) {
			oTitle.addEventDelegate(oPageChildrenAfterRenderingDelegate);
		}

		if (exists(oContent)) {
			oContent.addEventDelegate(oPageChildrenAfterRenderingDelegate);
		}
	};

	/**
	 * Attaches the Title press handlers
	 * @private
	 */
	DynamicPage.prototype._attachTitlePressHandler = function () {
		var oTitle = this.getTitle();

		if (exists(oTitle) && !this._bAlreadyAttachedTitlePressHandler) {
			oTitle.attachEvent(DynamicPage.EVENTS.TITLE_PRESS, this._titleExpandCollapseWhenAllowed, this);
			this._bAlreadyAttachedTitlePressHandler = true;
		}
	};

	/**
	 * Attaches the Pin/Unpin Button press handler
	 * @private
	 */
	DynamicPage.prototype._attachPinPressHandler = function () {
		var oHeader = this.getHeader();

		if (exists(oHeader) && !this._bAlreadyAttachedPinPressHandler) {
			oHeader.attachEvent(DynamicPage.EVENTS.PIN_UNPIN_PRESS, this._onPinUnpinButtonPress, this);
			this._bAlreadyAttachedPinPressHandler = true;
		}
	};

	/**
	 * Attaches the scroll the content scroll handler using the 'native' scroll event
	 * @private
	 */
	DynamicPage.prototype._attachScrollHandler = function () {
		this.$wrapper.on("scroll", this._onWrapperScroll.bind(this));
	};

	/**
	 * Detaches the scroll the content scroll handler using the 'native' scroll event
	 * @private
	 */
	DynamicPage.prototype._detachScrollHandler = function () {
		if (this.$wrapper) {
			this.$wrapper.unbind("scroll");
		}
	};

	return DynamicPage;

}, /* bExport= */ true);
