// Libraries
import React, { PureComponent } from 'react';
// Components
import { DataSourcePicker } from 'app/core/components/Select/DataSourcePicker';
import { Button, CustomScrollbar, HorizontalGroup, Modal, stylesFactory } from '@grafana/ui';
import { getDataSourceSrv } from '@grafana/runtime';
import { QueryEditorRows } from './QueryEditorRows';
// Services
import { backendSrv } from 'app/core/services/backend_srv';
import config from 'app/core/config';
// Types
import {
  DataQuery,
  DataSourceApi,
  DataSourceInstanceSettings,
  getDefaultTimeRange,
  LoadingState,
  PanelData,
} from '@grafana/data';
import { PluginHelp } from 'app/core/components/PluginHelp/PluginHelp';
import { addQuery } from 'app/core/utils/query';
import { Unsubscribable } from 'rxjs';
import { expressionDatasource, ExpressionDatasourceID } from 'app/features/expressions/ExpressionDatasource';
import { selectors } from '@grafana/e2e-selectors';
import { PanelQueryRunner } from '../state/PanelQueryRunner';
import { QueryGroupOptions, QueryGroupOptionsEditor } from './QueryGroupOptions';
import { DashboardQueryEditor, isSharedDashboardQuery } from 'app/plugins/datasource/dashboard';
import { css } from 'emotion';

interface Props {
  queryRunner: PanelQueryRunner;
  options: QueryGroupOptions;
  onOpenQueryInspector?: () => void;
  onRunQueries: () => void;
  onOptionsChange: (options: QueryGroupOptions) => void;
}

interface State {
  dataSource?: DataSourceApi;
  dsSettings?: DataSourceInstanceSettings;
  helpContent: React.ReactNode;
  isLoadingHelp: boolean;
  isPickerOpen: boolean;
  isAddingMixed: boolean;
  scrollTop: number;
  data: PanelData;
  isHelpOpen: boolean;
}

export class QueryGroup extends PureComponent<Props, State> {
  backendSrv = backendSrv;
  dataSourceSrv = getDataSourceSrv();
  querySubscription: Unsubscribable | null;

  state: State = {
    isLoadingHelp: false,
    helpContent: null,
    isPickerOpen: false,
    isAddingMixed: false,
    isHelpOpen: false,
    scrollTop: 0,
    data: {
      state: LoadingState.NotStarted,
      series: [],
      timeRange: getDefaultTimeRange(),
    },
  };

  async componentDidMount() {
    const { queryRunner, options } = this.props;

    this.querySubscription = queryRunner.getData({ withTransforms: false, withFieldConfig: false }).subscribe({
      next: (data: PanelData) => this.onPanelDataUpdate(data),
    });

    try {
      const ds = await this.dataSourceSrv.get(options.dataSource.name);
      const dsSettings = this.dataSourceSrv.getInstanceSettings(options.dataSource.name);
      this.setState({ dataSource: ds, dsSettings });
    } catch (error) {
      console.log('failed to load data source', error);
    }
  }

  componentWillUnmount() {
    if (this.querySubscription) {
      this.querySubscription.unsubscribe();
      this.querySubscription = null;
    }
  }

  onPanelDataUpdate(data: PanelData) {
    this.setState({ data });
  }

  onChangeDataSource = async (newSettings: DataSourceInstanceSettings) => {
    let { queries } = this.props.options;
    const { dsSettings } = this.state;

    // switching to mixed
    if (newSettings.meta.mixed) {
      for (const query of queries) {
        if (query.datasource !== ExpressionDatasourceID) {
          query.datasource = dsSettings?.name;
          if (!query.datasource) {
            query.datasource = config.defaultDatasource;
          }
        }
      }
    } else if (dsSettings) {
      // if switching from mixed
      if (dsSettings.meta.mixed) {
        // Remove the explicit datasource
        for (const query of queries) {
          if (query.datasource !== ExpressionDatasourceID) {
            delete query.datasource;
          }
        }
      } else if (dsSettings.meta.id !== newSettings.meta.id) {
        // we are changing data source type, clear queries
        queries = [{ refId: 'A' }];
      }
    }

    const dataSource = await this.dataSourceSrv.get(newSettings.name);

    this.onChange({
      queries,
      dataSource: {
        name: newSettings.name,
        uid: newSettings.uid,
        default: newSettings.isDefault,
      },
    });

    this.setState({
      dataSource: dataSource,
      dsSettings: newSettings,
    });
  };

  onAddQueryClick = () => {
    if (this.state.dsSettings?.meta.mixed) {
      this.setState({ isAddingMixed: true });
      return;
    }

    this.onChange({ queries: addQuery(this.props.options.queries) });
    this.onScrollBottom();
  };

  onChange(changedProps: Partial<QueryGroupOptions>) {
    this.props.onOptionsChange({
      ...this.props.options,
      ...changedProps,
    });
  }

  onAddExpressionClick = () => {
    this.onChange({
      queries: addQuery(this.props.options.queries, expressionDatasource.newQuery()),
    });
    this.onScrollBottom();
  };

  onScrollBottom = () => {
    this.setState({ scrollTop: 1000 });
  };

  onUpdateAndRun = (options: QueryGroupOptions) => {
    this.props.onOptionsChange(options);
    this.props.onRunQueries();
  };

  renderTopSection(styles: QueriesTabStyls) {
    const { onOpenQueryInspector, options } = this.props;
    const { dataSource, data } = this.state;

    return (
      <div>
        <div className={styles.dataSourceRow}>
          <div className={styles.dataSourceRowItem}>
            <DataSourcePicker
              onChange={this.onChangeDataSource}
              current={options.dataSource.name}
              metrics={true}
              mixed={true}
              dashboard={true}
              variables={true}
            />
          </div>
          {dataSource && (
            <>
              <div className={styles.dataSourceRowItem}>
                <Button
                  variant="secondary"
                  icon="question-circle"
                  title="Open data source help"
                  onClick={this.onOpenHelp}
                />
              </div>
              <div className={styles.dataSourceRowItemOptions}>
                <QueryGroupOptionsEditor
                  options={options}
                  dataSource={dataSource}
                  data={data}
                  onChange={this.onUpdateAndRun}
                />
              </div>
              {onOpenQueryInspector && (
                <div className={styles.dataSourceRowItem}>
                  <Button
                    variant="secondary"
                    onClick={onOpenQueryInspector}
                    aria-label={selectors.components.QueryTab.queryInspectorButton}
                  >
                    Query inspector
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  onOpenHelp = () => {
    this.setState({ isHelpOpen: true });
  };

  onCloseHelp = () => {
    this.setState({ isHelpOpen: false });
  };

  renderMixedPicker = () => {
    return (
      <DataSourcePicker
        mixed={false}
        onChange={this.onAddMixedQuery}
        current={null}
        autoFocus={true}
        onBlur={this.onMixedPickerBlur}
        openMenuOnFocus={true}
      />
    );
  };

  onAddMixedQuery = (datasource: any) => {
    this.onAddQuery({ datasource: datasource.name });
    this.setState({ isAddingMixed: false, scrollTop: this.state.scrollTop + 10000 });
  };

  onMixedPickerBlur = () => {
    this.setState({ isAddingMixed: false });
  };

  onAddQuery = (query: Partial<DataQuery>) => {
    const { queries } = this.props.options;
    this.onChange({ queries: addQuery(queries, query) });
    this.onScrollBottom();
  };

  setScrollTop = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    this.setState({ scrollTop: target.scrollTop });
  };

  onQueriesChange = (queries: DataQuery[]) => {
    this.onChange({ queries });
  };

  renderQueries(dsSettings: DataSourceInstanceSettings) {
    const { options, onRunQueries } = this.props;
    const { data } = this.state;

    if (isSharedDashboardQuery(dsSettings.name)) {
      return <DashboardQueryEditor queries={options.queries} panelData={data} onChange={this.onQueriesChange} />;
    }

    return (
      <div aria-label={selectors.components.QueryTab.content}>
        <QueryEditorRows
          queries={options.queries}
          dsSettings={dsSettings}
          onQueriesChange={this.onQueriesChange}
          onAddQuery={this.onAddQuery}
          onRunQueries={onRunQueries}
          data={data}
        />
      </div>
    );
  }

  renderAddQueryRow(dsSettings: DataSourceInstanceSettings) {
    const { isAddingMixed } = this.state;
    const showAddButton = !(isAddingMixed || isSharedDashboardQuery(dsSettings.name));

    return (
      <HorizontalGroup spacing="md" align="flex-start">
        {showAddButton && (
          <Button
            icon="plus"
            onClick={this.onAddQueryClick}
            variant="secondary"
            aria-label={selectors.components.QueryTab.addQuery}
          >
            Query
          </Button>
        )}
        {isAddingMixed && this.renderMixedPicker()}
        {config.featureToggles.expressions && (
          <Button icon="plus" onClick={this.onAddExpressionClick} variant="secondary">
            Expression
          </Button>
        )}
      </HorizontalGroup>
    );
  }

  render() {
    const { scrollTop, isHelpOpen, dsSettings } = this.state;
    const styles = getStyles();

    return (
      <CustomScrollbar
        autoHeightMin="100%"
        autoHide={true}
        updateAfterMountMs={300}
        scrollTop={scrollTop}
        setScrollTop={this.setScrollTop}
      >
        <div className={styles.innerWrapper}>
          {this.renderTopSection(styles)}
          {dsSettings && (
            <>
              <div className={styles.queriesWrapper}>{this.renderQueries(dsSettings)}</div>
              {this.renderAddQueryRow(dsSettings)}
              {isHelpOpen && (
                <Modal title="Data source help" isOpen={true} onDismiss={this.onCloseHelp}>
                  <PluginHelp plugin={dsSettings.meta} type="query_help" />
                </Modal>
              )}
            </>
          )}
        </div>
      </CustomScrollbar>
    );
  }
}

const getStyles = stylesFactory(() => {
  const { theme } = config;

  return {
    innerWrapper: css`
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: ${theme.spacing.md};
    `,
    dataSourceRow: css`
      display: flex;
      margin-bottom: ${theme.spacing.md};
    `,
    dataSourceRowItem: css`
      margin-right: ${theme.spacing.inlineFormMargin};
    `,
    dataSourceRowItemOptions: css`
      flex-grow: 1;
      margin-right: ${theme.spacing.inlineFormMargin};
    `,
    queriesWrapper: css`
      padding-bottom: 16px;
    `,
  };
});

type QueriesTabStyls = ReturnType<typeof getStyles>;
